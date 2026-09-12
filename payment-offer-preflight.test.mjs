import assert from "node:assert/strict";
import test from "node:test";

import { Challenge } from "mppx";

import {
  PaymentOfferPreflightError,
  createPinnedLookup,
  normalizePaymentTarget,
  paymentOfferPreflight,
  paymentOfferPreflightMcpOutputSchema,
  publicAddress,
  sanitizeLocationDiagnostic,
} from "./payment-offer-preflight.mjs";

const TARGET = "https://api.example.com/paid?a=1&b=2";
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NOW = Date.parse("2026-08-10T20:00:00.000Z");

function x402Header({ amount = "5000", resource = TARGET } = {}) {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: resource, description: "Paid test resource", mimeType: "application/json" },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: ASSET,
      amount,
      payTo: RECIPIENT,
      maxTimeoutSeconds: 300,
    }],
  })).toString("base64");
}

function mppHeader({ amount = "5000", realm = "api.example.com", expires = "2026-08-10T20:05:00.000Z" } = {}) {
  return Challenge.serialize(Challenge.from({
    id: "test-payment-challenge",
    realm,
    method: "evm",
    intent: "charge",
    expires,
    request: {
      amount,
      currency: ASSET,
      recipient: RECIPIENT,
      methodDetails: { chainId: 8453, credentialTypes: ["authorization"], decimals: 6 },
    },
  }));
}

function response({ status = 402, paymentRequired, authenticate, finalUrl = TARGET } = {}) {
  const headers = new Headers();
  if (paymentRequired) headers.set("payment-required", paymentRequired);
  if (authenticate) headers.set("www-authenticate", authenticate);
  return { status, headers, finalUrl };
}

function openapiDocument({ schema = {
  type: "object",
  required: ["risk", "evidence"],
  properties: { risk: { type: "number" }, evidence: { type: "array", items: { type: "string" } } },
} } = {}) {
  return { paths: { "/paid": { get: { responses: { 200: { content: { "application/json": { schema } } } } } } } };
}

test("normalizes only credential-free public HTTPS targets", () => {
  assert.equal(normalizePaymentTarget("https://api.example.com/paid?b=2&a=1").toString(), TARGET);
  assert.equal(
    normalizePaymentTarget("https://api.onesource.io/api/chain/ens/:input").toString(),
    "https://api.onesource.io/api/chain/ens/:input",
  );
  for (const value of [
    "http://api.example.com/paid",
    "https://user:pass@api.example.com/paid",
    "https://api.example.com/paid#fragment",
    "https://api.example.com/paid?api_key=secret",
    "https://localhost/paid",
    "https://127.0.0.1/paid",
    "https://[::1]/paid",
    "https://api.example.com/v1/{id}",
  ]) assert.throws(() => normalizePaymentTarget(value), PaymentOfferPreflightError);
});

test("public address policy rejects private, reserved, and documentation ranges", () => {
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const address of [
    "10.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "192.168.1.1",
    "203.0.113.4",
    "::1",
    "::7f00:1",
    "fe80::1",
    "2001:db8::1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::a00:1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2002:7f00:1::",
  ]) {
    assert.equal(publicAddress(address), false, address);
  }
});

test("pinned DNS lookup supports scalar and all-address Node callback contracts", async () => {
  const lookup = createPinnedLookup({ address: "8.8.8.8", family: 4 });
  const scalar = await new Promise((resolve, reject) => lookup("example.com", {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  const all = await new Promise((resolve, reject) => lookup("example.com", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(scalar, { address: "8.8.8.8", family: 4 });
  assert.deepEqual(all, [{ address: "8.8.8.8", family: 4 }]);
});

test("normalizes matching x402 and MPP offers without credentials or payment", async () => {
  const result = await paymentOfferPreflight({ url: TARGET }, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({
      paymentRequired: x402Header(),
      authenticate: mppHeader(),
    }),
  });

  assert.equal(result.decision, "parseable_offer");
  assert.deepEqual(result.protocols, ["mpp", "x402"]);
  assert.equal(result.offerCount, 2);
  assert.equal(result.offers.find((offer) => offer.protocol === "x402").expiresAt, "2026-08-10T20:05:00.000Z");
  assert.deepEqual(result.parity, { compared: true, consistent: true, driftFields: [] });
  assert.equal(result.offers.find((offer) => offer.protocol === "mpp").amountDisplay, "0.005");
  assert.deepEqual(result.responseContractAcquisition, {
    attempted: true,
    sameOrigin: true,
    path: "/openapi.json",
    maxBytes: 1_000_000,
    documentRead: true,
    targetResponseBodyRead: false,
    credentialsUsed: false,
    redirectsFollowed: false,
  });
  assert.deepEqual(result.boundary, {
    credentialsUsed: false,
    paymentSigned: false,
    paymentSent: false,
    targetResponseBodyRead: false,
    openApiDocumentRead: true,
    redirectsFollowed: false,
    claim: "Seller-declared response contracts are advisory. Parseable terms and schemas do not prove trust, utility, runtime validity, or settlement.",
  });
  assert.equal(JSON.stringify(result).includes("opaque"), false);
  assert.equal(JSON.stringify(result).includes("test-payment-challenge"), false);
  assert.equal(paymentOfferPreflightMcpOutputSchema.safeParse(result).success, true);
});

test("compares caller-supplied catalog metadata with each live unsigned offer", async () => {
  const catalog = {
    source: "coinbase-bazaar",
    protocol: "x402",
    method: "GET",
    url: TARGET,
    amountAtomic: "5000",
    network: "eip155:8453",
    asset: ASSET,
    recipient: RECIPIENT,
  };
  const result = await paymentOfferPreflight({ url: TARGET, catalog }, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({ paymentRequired: x402Header() }),
  });
  assert.equal(result.decision, "parseable_offer");
  assert.equal(result.catalogCoherence[0].decision, "partial");
  assert.deepEqual(result.catalogCoherence[0].unknown, ["expiry"]);
  assert.equal(result.findings.some((finding) => finding.code === "catalog_runtime_offer_partial"), true);
  assert.equal(JSON.stringify(result.catalogCoherence).includes("a=1"), false);
});

test("compares a protocol-specific catalog candidate only with that live protocol", async () => {
  const result = await paymentOfferPreflight({
    url: TARGET,
    catalog: {
      source: "coinbase-bazaar",
      protocol: "x402",
      method: "GET",
      url: TARGET,
      amountAtomic: "5000",
      network: "eip155:8453",
      asset: ASSET,
      recipient: RECIPIENT,
    },
  }, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({ paymentRequired: x402Header(), authenticate: mppHeader() }),
  });
  assert.equal(result.decision, "parseable_offer");
  assert.equal(result.catalogCoherence.length, 1);
  assert.equal(result.catalogCoherence[0].runtime.protocol, "x402");
  assert.equal(result.catalogCoherence[0].decision, "partial");
});

test("turns explicit catalog to runtime drift into review-required before authorization", async () => {
  const result = await paymentOfferPreflight({
    url: TARGET,
    catalog: {
      source: "agent402-index",
      protocol: "x402",
      method: "GET",
      url: TARGET,
      amountAtomic: "7000",
      network: "eip155:8453",
      asset: ASSET,
      recipient: RECIPIENT,
    },
  }, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({ paymentRequired: x402Header({ amount: "5000" }) }),
  });
  assert.equal(result.decision, "review_required");
  assert.deepEqual(result.catalogCoherence[0].drifted, ["amount"]);
  assert.equal(result.findings.some((finding) => finding.code === "catalog_runtime_offer_drift"), true);
});

test("rejects malformed catalog metadata before any target request", async () => {
  let called = false;
  await assert.rejects(paymentOfferPreflight({
    url: TARGET,
    catalog: { source: "registry", method: "POST", url: TARGET },
  }, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => { called = true; return response(); },
  }), (error) => error instanceof PaymentOfferPreflightError && error.code === "invalid_catalog");
  assert.equal(called, false);
});

test("flags economic drift across protocols", async () => {
  const result = await paymentOfferPreflight(TARGET, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({
      paymentRequired: x402Header({ amount: "5000" }),
      authenticate: mppHeader({ amount: "7000" }),
    }),
  });
  assert.equal(result.decision, "review_required");
  assert.deepEqual(result.parity.driftFields, ["amountAtomic"]);
  assert.equal(result.findings.some((finding) => finding.code === "protocol_economic_drift"), true);
});

test("fails closed on resource binding, realm, and expiry errors", async () => {
  const result = await paymentOfferPreflight(TARGET, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({
      paymentRequired: x402Header({ resource: "https://api.example.com/other" }),
      authenticate: mppHeader({ realm: "other.example.com", expires: "2026-08-10T19:59:59.000Z" }),
    }),
  });
  assert.equal(result.decision, "no_parseable_offer");
  assert.equal(result.offerCount, 0);
  assert.deepEqual(new Set(result.findings.map((finding) => finding.code)), new Set([
    "x402_resource_mismatch",
    "x402_offer_invalid",
    "mpp_realm_mismatch",
    "mpp_expired",
  ]));
});

test("reports a non-402 target without reading a response body", async () => {
  const result = await paymentOfferPreflight(TARGET, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({ status: 200 }),
  });
  assert.equal(result.decision, "no_parseable_offer");
  assert.equal(result.offerCount, 0);
  assert.deepEqual(result.findings.map((finding) => finding.code), ["expected_402_missing", "payment_offer_missing"]);
  assert.equal(result.target.locationClass, "absent");
  assert.equal(result.boundary.targetResponseBodyRead, false);
});

test("observes a same-origin 301 without following it or accusing the catalog", async () => {
  const headers = new Headers();
  headers.set("location", "/v1/fungibles/");
  const result = await paymentOfferPreflight("https://api.example.com/v1/fungibles", {
    now: NOW,
    openapiImpl: async () => null,
    requestImpl: async () => ({
      status: 301,
      headers,
      finalUrl: "https://api.example.com/v1/fungibles",
    }),
  });
  assert.equal(result.decision, "no_parseable_offer");
  assert.equal(result.target.httpStatus, 301);
  assert.equal(result.target.location, "/v1/fungibles/");
  assert.equal(result.target.locationClass, "same_origin");
  assert.equal(result.findings[0].code, "redirect_observed");
  assert.equal(result.findings[0].severity, "warning");
  assert.equal(result.findings[0].message.includes("not by itself a catalog-row defect"), true);
  assert.equal(result.boundary.redirectsFollowed, false);
  assert.equal(paymentOfferPreflightMcpOutputSchema.safeParse(result).success, true);
});

test("sanitizes hostile, credentialed, secret, and oversized Location values without following them", () => {
  const request = "https://api.example.com/v1/fungibles";
  assert.deepEqual(sanitizeLocationDiagnostic("/v1/fungibles/", request), {
    location: "/v1/fungibles/",
    locationClass: "same_origin",
  });
  const credentialed = sanitizeLocationDiagnostic("https://user:pass@evil.example/path?token=secret&q=ok", request);
  assert.equal(credentialed.locationClass, "cross_origin");
  assert.equal(credentialed.location.includes("user"), false);
  assert.equal(credentialed.location.includes("pass"), false);
  assert.equal(credentialed.location.includes("token="), false);
  assert.equal(credentialed.location.includes("q=ok"), true);
  for (const secretBearing of [
    "/reset/token/s3cr3t-value",
    "/session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
    "https://evil.example/%74oken/s3cr3t-value",
  ]) {
    const diagnostic = sanitizeLocationDiagnostic(secretBearing, request);
    assert.equal(diagnostic.location, null, secretBearing);
    assert.notEqual(diagnostic.locationClass, "absent", secretBearing);
  }
  for (const secretQuery of [
    "https://evil.example/callback?sessionToken=sekret&q=ok",
    "https://evil.example/callback?q=0123456789abcdef0123456789abcdef&safe=ok",
  ]) {
    const diagnostic = sanitizeLocationDiagnostic(secretQuery, request);
    assert.equal(diagnostic.location.includes("sekret"), false, secretQuery);
    assert.equal(diagnostic.location.includes("0123456789abcdef"), false, secretQuery);
  }
  assert.deepEqual(sanitizeLocationDiagnostic("../v1/other?q=ok", request), {
    location: "/v1/other?q=ok",
    locationClass: "same_origin",
  });
  assert.deepEqual(sanitizeLocationDiagnostic("/v1/monkey?q=ok", request), {
    location: "/v1/monkey?q=ok",
    locationClass: "same_origin",
  });
  assert.equal(sanitizeLocationDiagnostic("javascript:alert(1)", request).locationClass, "omitted");
  assert.equal(sanitizeLocationDiagnostic(`https://api.example.com/${"a".repeat(3000)}`, request).locationClass, "omitted");
  assert.equal(sanitizeLocationDiagnostic("https://api.example.com/ok\0", request).locationClass, "omitted");
});

test("valid 402 remains parseable without a redirect finding", async () => {
  const result = await paymentOfferPreflight({ url: TARGET }, {
    now: NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => response({
      paymentRequired: x402Header(),
      authenticate: mppHeader(),
    }),
  });
  assert.equal(result.decision, "parseable_offer");
  assert.equal(result.findings.some((finding) => finding.code === "redirect_observed"), false);
  assert.equal(result.target.locationClass, "absent");
  assert.equal(paymentOfferPreflightMcpOutputSchema.safeParse(result).success, true);
});

test("rejects a changed final URL", async () => {
  await assert.rejects(
    paymentOfferPreflight(TARGET, {
      now: NOW,
      openapiImpl: async () => openapiDocument(),
      requestImpl: async () => response({ finalUrl: "https://api.example.com/other" }),
    }),
    (error) => error instanceof PaymentOfferPreflightError && error.code === "redirect_rejected",
  );
});

test("marks a parseable payment offer review-required when the seller omits its success response schema", async () => {
  const result = await paymentOfferPreflight(TARGET, {
    now: NOW,
    requestImpl: async () => response({ paymentRequired: x402Header() }),
    openapiImpl: async () => ({ paths: { "/paid": { get: { responses: { 200: { description: "undocumented body" } } } } } }),
  });
  assert.equal(result.decision, "review_required");
  assert.equal(result.responseContract.decision, "absent");
  assert.equal(result.findings.some((finding) => finding.code === "seller_response_contract_absent"), true);
  assert.equal(result.boundary.targetResponseBodyRead, false);
  assert.equal(result.boundary.openApiDocumentRead, true);
});
