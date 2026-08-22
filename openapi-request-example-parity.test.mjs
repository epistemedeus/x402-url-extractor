import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_ENABLED_SURFACE_COUNTS,
  EXPECTED_PAID_METHOD_ROUTE_COUNTS,
  PUBLIC_SOLANA_SIGNATURE_QUERY,
  REQUEST_CONTRACT_ALIASES,
  applyDiscoveryRequestExamples,
  assertGeneratedOpenApiSurfaceGate,
  collectOpenApiRequestExampleFindings,
  credentialBearingUrlFindings,
  expectedPaidMethodRoutes,
  hasUnresolvedTemplate,
  isCredentialLikeValue,
  isSensitiveExampleName,
  isScalarQueryValue,
  parameterExampleValue,
  unsafeExampleFindings,
  validateExampleAgainstSchema,
  valuesCanonicallyEqual,
} from "./openapi-request-example-parity.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));

// Every required GET request input named in the accepted-construction gap.
const REQUIRED_QUERY_EXAMPLE_INPUTS = Object.freeze([
  Object.freeze(["GET", "/work/opportunity-preflight", "rewardUsd"]),
  Object.freeze(["GET", "/work/opportunity-preflight", "hours"]),
  Object.freeze(["GET", "/work/opportunity-preflight", "hourlyCostUsd"]),
  Object.freeze(["GET", "/chain/transaction-receipt", "transactionHash"]),
  Object.freeze(["GET", "/extract", "url"]),
  Object.freeze(["GET", "/read", "url"]),
  Object.freeze(["GET", "/scan", "repo"]),
  Object.freeze(["GET", "/schemaforge", "site"]),
  Object.freeze(["GET", "/enrich", "domain"]),
  Object.freeze(["GET", "/wallet-enrich", "address"]),
  Object.freeze(["GET", "/defi/morpho-position", "address"]),
  Object.freeze(["GET", "/defi/morpho-protection", "address"]),
  Object.freeze(["GET", "/defi/morpho-market-underwrite", "marketId"]),
  Object.freeze(["GET", "/defi/morpho-preliquidation-replay", "transactionHash"]),
]);

// The four canonical paid JSON-body POST operations (including the two POST
// aliases that share canonical GET routes).
const PAID_POST_ROUTES = Object.freeze([
  Object.freeze(["POST", "/work/opportunity-preflight"]),
  Object.freeze(["POST", "/commerce/payment-offer-preflight"]),
  Object.freeze(["POST", "/security/wallet-policy-conformance"]),
  Object.freeze(["POST", "/security/stateful-wallet-policy-conformance"]),
]);

const SOLANA_SIGNATURE_EXAMPLE = "3CjY38avdggKZbKfu2BmFYN4MUTiiNX27c8dHzPW79PrAx3huB9Pa6AfwW6sT4biax3y22z8toyLzmjtCc2QGNZn";

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function readJson(base, route) {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.ok, true, `${route} ${response.status}`);
  return response.json();
}

test("scopes the public signature exception to the canonical Solana receipt query", () => {
  assert.deepEqual(PUBLIC_SOLANA_SIGNATURE_QUERY, {
    method: "GET",
    route: "/chain/solana-transaction-receipt",
    field: "signature",
    schemaPattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$",
  });
  // The bare key is rejected everywhere by default...
  assert.equal(isSensitiveExampleName("signature"), true);
  assert.equal(isSensitiveExampleName("requestSignature"), true);
  // ...and allowed only through the explicitly scoped option, which the
  // projection and gate apply only on the exact method-route.
  assert.equal(isSensitiveExampleName("signature", { allowPublicSolanaSignatureField: true }), false);
  assert.equal(isSensitiveExampleName("requestSignature", { allowPublicSolanaSignatureField: true }), true);
  assert.equal(isSensitiveExampleName("api_token"), true);
  assert.equal(isSensitiveExampleName("accessToken"), true);
  assert.equal(isSensitiveExampleName("session-id"), true);
  assert.equal(isSensitiveExampleName("__proto__"), true);
  assert.equal(isSensitiveExampleName("rewardUsd"), false);
  assert.equal(isSensitiveExampleName("hourlyCostUsd"), false);
});

test("classifies scalars, templates, and credential-like values", () => {
  assert.equal(isCredentialLikeValue("Bearer abc.def"), true);
  assert.equal(isCredentialLikeValue("sk-live-abc123"), true);
  assert.equal(isCredentialLikeValue("eyJhbGciOi.eyJzdWIi.sig"), true);
  assert.equal(isCredentialLikeValue("https://example.com/page"), false);
  assert.equal(hasUnresolvedTemplate("{url}"), true);
  assert.equal(hasUnresolvedTemplate("https://example.com"), false);
  assert.equal(isScalarQueryValue("https://example.com"), true);
  assert.equal(isScalarQueryValue(10), true);
  assert.equal(isScalarQueryValue(false), true);
  assert.equal(isScalarQueryValue(""), false);
  assert.equal(isScalarQueryValue({ url: "https://example.com" }), false);
  assert.equal(isScalarQueryValue(undefined), false);
});

test("rejects credential-bearing URLs and keeps ordinary public URLs valid", () => {
  // Ordinary public URLs — including ordinary query strings — stay valid.
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/page"), []);
  assert.deepEqual(credentialBearingUrlFindings("https://agents.samedaydesk.com/defi/morpho-position?address=0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e"), []);
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/extract?url=https%3A%2F%2Fexample.com"), []);
  assert.deepEqual(credentialBearingUrlFindings("eip155:8453"), []);
  assert.deepEqual(credentialBearingUrlFindings("0x8ee9c15c3e5332cbc6ef39a2bb036c63c6549b6e"), []);
  // Userinfo, fragments, sensitive query keys/values, nested URL userinfo, and hidden channels.
  assert.ok(credentialBearingUrlFindings("https://user:pass@example.com/page").some((f) => f.includes("userinfo")));
  assert.ok(credentialBearingUrlFindings("https://example.com/page#token=zzz").some((f) => f.includes("fragment")));
  assert.ok(credentialBearingUrlFindings("https://example.com/page?api_key=sk-live-abc123").some((f) => f.includes("api_key")));
  assert.ok(credentialBearingUrlFindings("https://example.com/page?authorization=Bearer%20zzz").some((f) => f.includes("authorization")));
  assert.ok(credentialBearingUrlFindings("https://example.com/page?session=abc123").some((f) => f.includes("session")));
  assert.ok(credentialBearingUrlFindings("https://example.com/extract?url=https://user:pass@evil.example/").some((f) => f.includes("userinfo")));
});

const SECRET_MATERIAL_RE = /plain-secret-material|user:pass|sk-live-abc123|Bearer zzz/i;

function assertFindingsFailClosedWithoutSecrets(findings, { mustInclude, mustNotThrowLabel }) {
  assert.ok(Array.isArray(findings), `${mustNotThrowLabel} must return findings, not throw`);
  assert.ok(findings.length > 0, `${mustNotThrowLabel} must fail closed`);
  assert.ok(mustInclude.some((needle) => findings.some((finding) => finding.includes(needle))), `${mustNotThrowLabel} findings ${JSON.stringify(findings)}`);
  assert.equal(SECRET_MATERIAL_RE.test(findings.join("\n")), false, `${mustNotThrowLabel} leaked secret material: ${JSON.stringify(findings)}`);
}

test("bounded multi-decode URL privacy fails closed without URIError or secret leakage", () => {
  const probes = [
    {
      label: "twice-encoded sensitive query key",
      value: "https://example.com/?%2574oken=plain-secret-material",
      needles: ["query key", "credential-like"],
    },
    {
      label: "twice-encoded nested userinfo URL",
      value: "https://example.com/?next=https%253A%252F%252Fu%253Ap%2540evil.example%252F",
      needles: ["userinfo"],
    },
    {
      label: "twice-encoded credential-like path",
      value: "https://example.com/%2573k-live-abc123",
      needles: ["credential-like"],
    },
    {
      label: "once-encoded credential-like path",
      value: "https://example.com/%73k-live-abc123",
      needles: ["credential-like"],
    },
    {
      label: "credential-like host label",
      value: "https://sk-live-abc123.example.com/page",
      needles: ["host"],
    },
    {
      label: "malformed percent encoding",
      value: "https://example.com/%ZZ",
      needles: ["malformed percent encoding"],
    },
    {
      label: "truncated percent encoding",
      value: "https://example.com/%2",
      needles: ["malformed percent encoding"],
    },
    {
      label: "invalid UTF-8 percent sequence",
      value: "https://example.com/%80",
      needles: ["malformed percent encoding"],
    },
  ];
  for (const probe of probes) {
    let findings;
    try {
      findings = credentialBearingUrlFindings(probe.value);
    } catch (error) {
      assert.notEqual(error?.name, "URIError", `${probe.label} threw URIError`);
      throw error;
    }
    assertFindingsFailClosedWithoutSecrets(findings, { mustInclude: probe.needles, mustNotThrowLabel: probe.label });
  }
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/extract?url=https%3A%2F%2Fexample.com"), []);
  assert.deepEqual(credentialBearingUrlFindings("https://example.com/page"), []);
});

test("nested object example values fail closed on encoded secrets and encoded URLs", () => {
  assertFindingsFailClosedWithoutSecrets(
    unsafeExampleFindings({ nested: { target: "https://example.com/?%2574oken=plain-secret-material" } }),
    { mustInclude: ["query key", "credential-like"], mustNotThrowLabel: "nested twice-encoded query key" },
  );
  assertFindingsFailClosedWithoutSecrets(
    unsafeExampleFindings({ nested: { next: "https://example.com/?next=https%253A%252F%252Fu%253Ap%2540evil.example%252F" } }),
    { mustInclude: ["userinfo"], mustNotThrowLabel: "nested twice-encoded userinfo" },
  );
  assertFindingsFailClosedWithoutSecrets(
    unsafeExampleFindings({ header: "%73k-live-abc123" }),
    { mustInclude: ["credential-like example value"], mustNotThrowLabel: "once-encoded nested secret value" },
  );
  assertFindingsFailClosedWithoutSecrets(
    unsafeExampleFindings({ header: "%2573k-live-abc123" }),
    { mustInclude: ["credential-like example value"], mustNotThrowLabel: "twice-encoded nested secret value" },
  );
  assertFindingsFailClosedWithoutSecrets(
    unsafeExampleFindings({ "%2574oken": "public" }),
    { mustInclude: ["credential-like example key"], mustNotThrowLabel: "twice-encoded nested secret key" },
  );
  assert.deepEqual(unsafeExampleFindings({ ok: true, url: "https://example.com" }), []);
});

test("walks example trees for credential-like keys, prototype names, templates, and URLs", () => {
  assert.deepEqual(unsafeExampleFindings({ ok: true, url: "https://example.com" }), []);
  assert.ok(unsafeExampleFindings({ api_token: "not-a-secret" }).includes("$.api_token: credential-like example key"));
  assert.ok(unsafeExampleFindings({ nested: { constructor: {} } }).some((entry) => entry.includes("prototype name")));
  assert.ok(unsafeExampleFindings({ note: "{missing}" }).includes("$.note: unresolved template in example value"));
  assert.ok(unsafeExampleFindings({ header: "Bearer zzz" }).includes("$.header: credential-like example value"));
  assert.ok(unsafeExampleFindings({ target: "https://u:p@example.com" }).some((entry) => entry.includes("userinfo")));
  assert.ok(unsafeExampleFindings({ target: "https://example.com/?token=zz" }).some((entry) => entry.includes("token")));
});

test("compares values canonically without stringify order equality", () => {
  assert.equal(valuesCanonicallyEqual({ a: 1, b: [2, { c: 3 }] }, { b: [2, { c: 3 }], a: 1 }), true);
  assert.equal(valuesCanonicallyEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(valuesCanonicallyEqual([1, 2], [2, 1]), false);
  assert.equal(valuesCanonicallyEqual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(valuesCanonicallyEqual("x", "x"), true);
  assert.equal(valuesCanonicallyEqual(10, 10), true);
  assert.equal(JSON.stringify({ b: 1, a: 2 }) === JSON.stringify({ a: 2, b: 1 }), false);
  assert.equal(valuesCanonicallyEqual({ b: 1, a: 2 }, { a: 2, b: 1 }), true);
});

test("validates examples with the standards-complete 2020-12 validator, fail-closed on hostile schemas", () => {
  // Core assertion vocabulary.
  assert.deepEqual(validateExampleAgainstSchema(10, { type: "number", exclusiveMinimum: 0 }), []);
  assert.ok(validateExampleAgainstSchema(0, { type: "number", exclusiveMinimum: 0 }).length > 0);
  assert.ok(validateExampleAgainstSchema(-1, { type: "number", minimum: 0 }).length > 0);
  assert.deepEqual(validateExampleAgainstSchema(`0x${"a".repeat(40)}`, { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }), []);
  assert.ok(validateExampleAgainstSchema("nope", { type: "string", enum: ["base", "ethereum"] }).length > 0);
  assert.ok(validateExampleAgainstSchema("not-a-timestamp", { type: "string", format: "date-time" }).length > 0);
  assert.deepEqual(validateExampleAgainstSchema("https://example.com", { type: "string", format: "uri" }), []);
  assert.ok(validateExampleAgainstSchema("https://u:p@example.com", { type: "string", format: "uri" }).length > 0);
  assert.ok(validateExampleAgainstSchema(1.5, { type: "integer" }).length > 0);
  assert.deepEqual(
    validateExampleAgainstSchema(
      { url: "https://example.com" },
      { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"], additionalProperties: false },
    ),
    [],
  );
  assert.ok(
    validateExampleAgainstSchema(
      { catalog: { source: "x" } },
      { type: "object", properties: { url: { type: "string" }, catalog: { type: "object" } }, required: ["url"], additionalProperties: false },
    ).length > 0,
  );
  // Applicators the old fail-open subset silently ignored.
  assert.deepEqual(validateExampleAgainstSchema("abc", { allOf: [{ type: "string" }, { minLength: 2 }] }), []);
  assert.ok(validateExampleAgainstSchema(7, { allOf: [{ type: "string" }] }).length > 0);
  assert.deepEqual(validateExampleAgainstSchema(5, { oneOf: [{ type: "string" }, { type: "number" }] }), []);
  assert.ok(validateExampleAgainstSchema(true, { oneOf: [{ type: "string" }, { type: "number" }] }).length > 0);
  assert.deepEqual(validateExampleAgainstSchema("x", { anyOf: [{ type: "string" }, { type: "number" }] }), []);
  assert.ok(validateExampleAgainstSchema("x", { not: { type: "string" } }).length > 0);
  assert.deepEqual(
    validateExampleAgainstSchema("hot", { if: { type: "string" }, then: { minLength: 2 }, else: { type: "number" } }),
    [],
  );
  assert.ok(
    validateExampleAgainstSchema("x", { if: { type: "string" }, then: { minLength: 2 }, else: { type: "number" } }).length > 0,
  );
  assert.deepEqual(
    validateExampleAgainstSchema({ known: "x" }, { type: "object", properties: { known: { type: "string" } }, unevaluatedProperties: false }),
    [],
  );
  assert.ok(
    validateExampleAgainstSchema({ known: "x", extra: 1 }, { type: "object", properties: { known: { type: "string" } }, unevaluatedProperties: false }).length > 0,
  );
  assert.deepEqual(
    validateExampleAgainstSchema({ a: "x", name: "n" }, {
      type: "object",
      properties: { a: { type: "string" } },
      dependentSchemas: { a: { properties: { name: { type: "string" } }, required: ["name"] } },
    }),
    [],
  );
  assert.ok(
    validateExampleAgainstSchema({ a: "x" }, {
      type: "object",
      properties: { a: { type: "string" } },
      dependentSchemas: { a: { properties: { name: { type: "string" } }, required: ["name"] } },
    }).length > 0,
  );
  assert.ok(
    validateExampleAgainstSchema({ a: 1 }, {
      type: "object",
      properties: { a: { type: "number" }, name: { type: "string" } },
      dependentRequired: { a: ["name"] },
    }).length > 0,
  );
  assert.deepEqual(
    validateExampleAgainstSchema({ a: 1, name: "n" }, {
      type: "object",
      properties: { a: { type: "number" }, name: { type: "string" } },
      dependentRequired: { a: ["name"] },
    }),
    [],
  );
  assert.deepEqual(validateExampleAgainstSchema({ tag: "ab" }, {
    type: "object",
    patternProperties: { "^tag$": { type: "string", minLength: 2 } },
    propertyNames: { pattern: "^[a-z]+$" },
  }), []);
  // Local $ref resolution works; const/enum equality is structural (key-order insensitive).
  assert.deepEqual(
    validateExampleAgainstSchema({ nested: 1 }, { $defs: { inner: { type: "integer" } }, properties: { nested: { $ref: "#/$defs/inner" } }, required: ["nested"] }),
    [],
  );
  assert.deepEqual(validateExampleAgainstSchema({ b: 1, a: 2 }, { const: { a: 2, b: 1 } }), []);
  assert.ok(validateExampleAgainstSchema({ a: 2, b: 1 }, { const: { a: 1, b: 1 } }).length > 0);
  // Property names are not treated as schema keywords (no false fail-closed).
  assert.deepEqual(
    validateExampleAgainstSchema({ url: "https://example.com" }, {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    }),
    [],
  );
  // Fail closed on every unsupported/hostile schema shape.
  assert.ok(validateExampleAgainstSchema("x", { $ref: "https://evil.example/schema.json" }).some((e) => e.includes("non-local $ref")));
  assert.ok(validateExampleAgainstSchema("x", { $ref: "./sibling.json" }).some((e) => e.includes("non-local $ref")));
  assert.ok(validateExampleAgainstSchema("x", { $ref: "#anchor" }).some((e) => e.includes("non-local $ref")));
  assert.ok(validateExampleAgainstSchema("x", { $ref: "#/definitions/missing" }).some((e) => e.includes("fail closed")));
  assert.ok(validateExampleAgainstSchema("x", { $schema: "http://json-schema.org/draft-07/schema#" }).some((e) => e.includes("dialect")));
  assert.ok(validateExampleAgainstSchema("x", { $id: "https://evil.example/x" }).some((e) => e.includes("$id")));
  assert.ok(validateExampleAgainstSchema("x", { properties: { deep: { $ref: "http://x.example/y" } } }).some((e) => e.includes("non-local $ref")));
  assert.ok(validateExampleAgainstSchema("x", { $dynamicRef: "#foo" }).some((e) => e.includes("fail closed")));
  assert.ok(validateExampleAgainstSchema("x", { contentSchema: { type: "object" } }).some((e) => e.includes("unsupported schema keyword")));
});

test("required GET missing and boolean-false request schemas fail closed before listen", () => {
  assert.ok(validateExampleAgainstSchema("x", false).some((error) => error.includes("boolean schema false")));
  assert.ok(validateExampleAgainstSchema("x", undefined).some((error) => error.includes("request schema is missing")));
  assert.ok(validateExampleAgainstSchema("x", null).some((error) => error.includes("request schema is missing")));
  assert.ok(validateExampleAgainstSchema("x", []).some((error) => error.includes("must be a boolean or object")));
  assert.deepEqual(validateExampleAgainstSchema("x", true), []);
  assert.ok(validateExampleAgainstSchema("https://u:p@example.com", true).some((error) => error.includes("userinfo")));

  const falseDocument = { paths: {
    "/q": paidGetOperation([{ name: "q", in: "query", required: true, schema: false, example: "x" }]),
  } };
  const missingDocument = { paths: {
    "/q": paidGetOperation([{ name: "q", in: "query", required: true, example: "x" }]),
  } };
  assert.ok(collectOpenApiRequestExampleFindings({ document: falseDocument })
    .some((finding) => finding.includes("boolean schema false")));
  assert.ok(collectOpenApiRequestExampleFindings({ document: missingDocument })
    .some((finding) => finding.includes("request schema is missing")));

  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: false }]) },
  }, () => structuredClone(EXTRACT_CONTRACT)), /boolean schema false/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "url", in: "query", required: true }]) },
  }, () => structuredClone(EXTRACT_CONTRACT)), /request schema is missing/);
});

test("2020-12 tuple projection fails closed on obsolete additionalItems and honors unevaluatedItems", () => {
  const obsolete = { type: "array", prefixItems: [{ type: "number" }], additionalItems: false };
  const findings = validateExampleAgainstSchema([1, "escape"], obsolete);
  assert.ok(findings.some((error) => error.includes("additionalItems")), findings);
  assert.ok(findings.some((error) => error.includes("unsupported schema keyword")), findings);
  assert.ok(
    validateExampleAgainstSchema([1, "escape"], {
      type: "array",
      prefixItems: [{ type: "number" }],
      unevaluatedItems: false,
    }).length > 0,
  );
  assert.deepEqual(
    validateExampleAgainstSchema([1], {
      type: "array",
      prefixItems: [{ type: "number" }],
      unevaluatedItems: false,
    }),
    [],
  );
});

function paidGetOperation(parameters) {
  return {
    get: {
      "x-payment-info": {},
      parameters,
      responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
    },
  };
}

const EXTRACT_CONTRACT = Object.freeze({
  example: { type: "http", method: "GET", queryParams: { url: "https://example.com" } },
  schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
});

function contractFor(routeKey) {
  if (
    routeKey === "GET /equal"
    || routeKey === "GET /drifted"
    || routeKey === "GET /missing"
    || routeKey === "GET /commerce/payment-offer-preflight"
  ) return structuredClone(EXTRACT_CONTRACT);
  return null;
}

test("projects canonical examples with authority over authored ones", () => {
  assert.equal(REQUEST_CONTRACT_ALIASES["GET /gateway/commerce/payment-offer-preflight"], "GET /commerce/payment-offer-preflight");
  const document = { paths: {
    // Authored example canonically equal to the canonical value stays.
    "/equal": paidGetOperation([
      { name: "url", in: "query", required: true, schema: { type: "string", example: "https://example.com" } },
    ]),
    // Drifted authored example is deterministically overwritten.
    "/drifted": paidGetOperation([
      { name: "url", in: "query", required: true, schema: { type: "string", example: "https://stale.example" } },
    ]),
    // Missing example is applied.
    "/missing": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]),
    // The Circle gateway GET alias resolves through the explicit alias map.
    "/gateway/commerce/payment-offer-preflight": paidGetOperation([
      { name: "url", in: "query", required: true, schema: { type: "string" } },
    ]),
    "/free": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]),
  } };
  const receipt = applyDiscoveryRequestExamples(document, contractFor);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.queryExamples, 2);
  assert.equal(receipt.queryVerified, 1);
  assert.equal(receipt.queryOverwritten, 1);
  assert.equal(document.paths["/equal"].get.parameters[0].schema.example, "https://example.com");
  assert.equal(document.paths["/drifted"].get.parameters[0].schema.example, undefined);
  assert.equal(document.paths["/drifted"].get.parameters[0].example, "https://example.com");
  assert.equal(document.paths["/missing"].get.parameters[0].example, "https://example.com");
  const aliasParameter = document.paths["/gateway/commerce/payment-offer-preflight"].get.parameters[0];
  assert.equal(aliasParameter.example ?? aliasParameter.schema?.example, "https://example.com");
  // Idempotent re-run: everything verifies, nothing changes.
  const second = applyDiscoveryRequestExamples(document, contractFor);
  assert.equal(second.queryExamples, 0);
  assert.equal(second.queryOverwritten, 0);
  assert.equal(second.queryVerified, 4);
});

test("projection throws loudly on missing parameters and unsafe canonical values", () => {
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/preflight": { post: { "x-payment-info": {}, requestBody: { content: { "application/json": { schema: { type: "object" } } } } } } },
  }, () => ({ example: { method: "POST" }, schema: {} })), /lacks a JSON body example/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "rewardUsd", in: "query", required: true, schema: { type: "number" } }]) },
  }, () => (structuredClone(EXTRACT_CONTRACT))), /declares no query parameter for required discovery input url/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]) },
  }, () => ({
    example: { queryParams: { url: "{template}" } },
    schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
  })), /unresolved template/);
  assert.throws(() => applyDiscoveryRequestExamples({
    paths: { "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" } }]) },
  }, () => ({
    example: { queryParams: { url: "https://u:p@example.com" } },
    schema: { type: "object", properties: { queryParams: { required: ["url"] } } },
  })), /credential-bearing URL/);
});

test("canonical POST body overwrites a drifted authored example", () => {
  const contract = {
    example: { type: "http", method: "POST", bodyType: "json", body: { url: "https://example.com" } },
    schema: { type: "object" },
  };
  const document = { paths: {
    "/preflight": { post: {
      "x-payment-info": {},
      requestBody: { content: { "application/json": {
        schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
        example: { url: "https://stale.example" },
      } } },
      responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
    } },
  } };
  const receipt = applyDiscoveryRequestExamples(document, () => contract);
  assert.equal(receipt.bodyOverwritten, 1);
  assert.deepEqual(document.paths["/preflight"].post.requestBody.content["application/json"].example, { url: "https://example.com" });
});

const SOLANA_CONTRACT = Object.freeze({
  example: { type: "http", method: "GET", queryParams: { signature: SOLANA_SIGNATURE_EXAMPLE } },
  schema: {
    type: "object",
    properties: { queryParams: { required: ["signature"] } },
  },
});

test("enforces the scoped signature exception only on the canonical Solana receipt route", () => {
  const canonicalSchema = { type: "string", pattern: PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern };
  const document = { paths: {
    "/chain/solana-transaction-receipt": paidGetOperation([
      { name: "signature", in: "query", required: true, schema: structuredClone(canonicalSchema) },
    ]),
  } };
  const receipt = applyDiscoveryRequestExamples(document, (routeKey) => (
    routeKey === "GET /chain/solana-transaction-receipt" ? structuredClone(SOLANA_CONTRACT) : null
  ));
  assert.equal(receipt.queryExamples, 1);
  assert.equal(document.paths["/chain/solana-transaction-receipt"].get.parameters[0].example, SOLANA_SIGNATURE_EXAMPLE);

  // Wrong schema under the exception is rejected.
  assert.throws(() => applyDiscoveryRequestExamples({ paths: {
    "/chain/solana-transaction-receipt": paidGetOperation([
      { name: "signature", in: "query", required: true, schema: { type: "string", pattern: "^.*$" } },
    ]),
  } }, (routeKey) => (routeKey === "GET /chain/solana-transaction-receipt" ? structuredClone(SOLANA_CONTRACT) : null)), /canonical public Solana base58 schema/);

  // The same contract key anywhere else is rejected as credential-like.
  assert.throws(() => applyDiscoveryRequestExamples({ paths: {
    "/elsewhere": paidGetOperation([
      { name: "signature", in: "query", required: true, schema: structuredClone(canonicalSchema) },
    ]),
  } }, (routeKey) => (routeKey === "GET /elsewhere" ? structuredClone(SOLANA_CONTRACT) : null)), /unsafe accepted example/);
});

test("parity gate audits every generated paid operation and the exact inventory", () => {
  const healthy = { paths: {
    "/extract": paidGetOperation([{ name: "url", in: "query", required: true, schema: { type: "string" }, example: "https://example.com" }]),
    "/work/opportunity-preflight": { post: {
      "x-payment-info": {},
      requestBody: { content: { "application/json": {
        schema: { type: "object", properties: { rewardUsd: { type: "number", exclusiveMinimum: 0 } }, required: ["rewardUsd"] },
        example: { rewardUsd: 10 },
      } } },
      responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
    } },
  } };

  // Full-surface enumeration needs no action list at all.
  assert.deepEqual(collectOpenApiRequestExampleFindings({ document: healthy }), []);

  const lostQuery = structuredClone(healthy);
  delete lostQuery.paths["/extract"].get.parameters[0].example;
  assert.ok(collectOpenApiRequestExampleFindings({ document: lostQuery })
    .includes("GET /extract: required query input url lost its accepted request example"));

  const nonScalar = structuredClone(healthy);
  nonScalar.paths["/extract"].get.parameters[0].example = { url: "https://example.com" };
  assert.ok(collectOpenApiRequestExampleFindings({ document: nonScalar })
    .includes("GET /extract: required query input url example is not a non-empty scalar"));

  const templated = structuredClone(healthy);
  templated.paths["/extract"].get.parameters[0].example = "{your-url-here}";
  assert.ok(collectOpenApiRequestExampleFindings({ document: templated })
    .includes("GET /extract: required query input url example contains an unresolved template"));

  const credential = structuredClone(healthy);
  credential.paths["/extract"].get.parameters[0] = { name: "api_token", in: "query", required: true, schema: { type: "string" }, example: "Bearer zz" };
  assert.ok(collectOpenApiRequestExampleFindings({ document: credential })
    .some((finding) => finding.includes("credential-like") && finding.startsWith("GET /extract")));

  // A bare `signature` key outside the scoped exception is rejected.
  const signatureElsewhere = structuredClone(healthy);
  signatureElsewhere.paths["/extract"].get.parameters[0] = { name: "signature", in: "query", required: true, schema: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{80,90}$" }, example: SOLANA_SIGNATURE_EXAMPLE };
  assert.ok(collectOpenApiRequestExampleFindings({ document: signatureElsewhere })
    .some((finding) => finding.startsWith("GET /extract") && finding.includes("credential-like")));

  const bodyMismatch = structuredClone(healthy);
  delete bodyMismatch.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example.rewardUsd;
  assert.ok(collectOpenApiRequestExampleFindings({ document: bodyMismatch })
    .some((finding) => finding.startsWith("POST /work/opportunity-preflight") && finding.includes("rewardUsd")));

  const bodyLost = structuredClone(healthy);
  delete bodyLost.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example;
  assert.ok(collectOpenApiRequestExampleFindings({ document: bodyLost })
    .includes("POST /work/opportunity-preflight: JSON request body lost its accepted construction example"));

  const lostSuccessSchema = structuredClone(healthy);
  delete lostSuccessSchema.paths["/work/opportunity-preflight"].post.responses["200"].content;
  assert.ok(collectOpenApiRequestExampleFindings({ document: lostSuccessSchema })
    .includes("POST /work/opportunity-preflight: paid operation lost its formal 200 JSON response schema"));

  const credentialUrlBody = structuredClone(healthy);
  credentialUrlBody.paths["/work/opportunity-preflight"].post.requestBody.content["application/json"].example.target = "https://u:p@example.com";
  assert.ok(collectOpenApiRequestExampleFindings({ document: credentialUrlBody })
    .some((finding) => finding.startsWith("POST /work/opportunity-preflight") && finding.includes("userinfo")));

  // Exact inventory reconciliation: missing, renamed, and extra routes drift.
  const expected = expectedPaidMethodRoutes({ profile: "mpp", circleGatewayEnabled: false });
  assert.equal(expected.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.mpp);
  assert.ok(collectOpenApiRequestExampleFindings({ document: healthy, expectedPaidMethodRoutes: expected })
    .some((finding) => finding.includes("paid inventory drift")));
  const catalog = [{ method: "GET", route: "/not-a-paid-route" }];
  assert.ok(collectOpenApiRequestExampleFindings({ document: healthy, actions: catalog })
    .some((finding) => finding.includes("canonical catalog action missing from the generated paid surface")));
});

test("startup generation gate fails closed on inventory drift and missing contracts", () => {
  assert.throws(() => assertGeneratedOpenApiSurfaceGate(), /documents/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({ documents: {} }), /resolveRequestContract/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({
    documents: { agentcash: { paths: {} }, mpp: { paths: {} } },
  }), /resolveRequestContract/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({
    documents: { agentcash: { paths: {} }, mpp: { paths: {} } },
    resolveRequestContract: () => null,
    circleGatewayEnabled: true,
  }), /generation gate failed/);
  assert.throws(() => assertGeneratedOpenApiSurfaceGate({
    documents: { agentcash: { paths: {} }, mpp: { paths: {} } },
    resolveRequestContract: () => structuredClone(EXTRACT_CONTRACT),
    circleGatewayEnabled: true,
  }), /missing canonical request contract|paid inventory drift/);
  assert.equal(EXPECTED_PAID_METHOD_ROUTE_COUNTS.agentcash, 25);
  assert.equal(EXPECTED_PAID_METHOD_ROUTE_COUNTS.mpp, 24);
  assert.equal(EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleEnabled, 25);
  assert.equal(EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled, 24);
  assert.equal(EXPECTED_ENABLED_SURFACE_COUNTS.mpp, 24);
  assert.equal(expectedPaidMethodRoutes({ profile: "agentcash", circleGatewayEnabled: true }).length, EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleEnabled);
  assert.equal(expectedPaidMethodRoutes({ profile: "agentcash", circleGatewayEnabled: false }).length, EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled);
  assert.equal(expectedPaidMethodRoutes({ profile: "mpp", circleGatewayEnabled: true }).length, EXPECTED_ENABLED_SURFACE_COUNTS.mpp);
  assert.equal(expectedPaidMethodRoutes({ profile: "mpp", circleGatewayEnabled: false }).length, EXPECTED_ENABLED_SURFACE_COUNTS.mpp);
});

function paidMethodRoutesOf(document) {
  const routes = [];
  for (const [pathname, pathItem] of Object.entries(document.paths)) {
    for (const method of ["get", "post"]) {
      if (pathItem?.[method]?.["x-payment-info"]) routes.push(`${method.toUpperCase()} ${pathname}`);
    }
  }
  return routes.sort();
}

async function bootServer(t, extraEnv = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-openapi-parity-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal(await listening, true);
  assert.equal(SERVICE_VERSION, "1.23.20");
  return `http://127.0.0.1:${port}`;
}

test("live generated surface: exact 25/24 paid inventories, full parity, zero findings", { timeout: 90_000 }, async (t) => {
  const base = await bootServer(t);
  const catalog = await readJson(base, "/api/actions");
  assert.equal(catalog.actions.length, 22);

  for (const [profile, route] of [["agentcash", "/openapi.json"], ["mpp", "/mpp-openapi.json"]]) {
    const document = await readJson(base, route);
    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.version, "1.23.20");

    // Exact paid inventory reconciliation over EVERY generated paid operation.
    const expectedRoutes = expectedPaidMethodRoutes({ profile, circleGatewayEnabled: true });
    assert.equal(expectedRoutes.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS[profile]);
    assert.deepEqual(paidMethodRoutesOf(document), expectedRoutes);

    // Full request-example, response-schema, and safety parity across 25/24.
    const findings = collectOpenApiRequestExampleFindings({ document, actions: catalog.actions, expectedPaidMethodRoutes: expectedRoutes });
    assert.deepEqual(findings, []);

    for (const [method, actionPath, name] of REQUIRED_QUERY_EXAMPLE_INPUTS) {
      const parameter = document.paths[actionPath].get.parameters.find((entry) => entry.in === "query" && entry.name === name && entry.required === true);
      assert.ok(parameter, `${method} ${actionPath} missing required query input ${name} in ${profile}`);
      assert.ok(isScalarQueryValue(parameterExampleValue(parameter)), `${method} ${actionPath} query input ${name} lacks a scalar example in ${profile}`);
    }
    for (const [, actionPath] of PAID_POST_ROUTES) {
      const bodyExample = document.paths[actionPath].post.requestBody.content["application/json"].example;
      assert.ok(bodyExample && typeof bodyExample === "object", `${actionPath} lacks a JSON-body request example in ${profile}`);
    }

    // The scoped public signature exception carries the canonical base58 schema.
    const solanaOperation = document.paths["/chain/solana-transaction-receipt"].get;
    const signatureParameter = solanaOperation.parameters.find((entry) => entry.in === "query" && entry.name === "signature" && entry.required === true);
    assert.equal(signatureParameter.schema.pattern, PUBLIC_SOLANA_SIGNATURE_QUERY.schemaPattern);
    assert.equal(signatureParameter.example, SOLANA_SIGNATURE_EXAMPLE);
  }

  // The Circle gateway GET alias maps onto its canonical GET request contract:
  // its accepted example is canonically equal to the canonical contract value.
  const agentcash = await readJson(base, "/openapi.json");
  const aliasParameter = agentcash.paths["/gateway/commerce/payment-offer-preflight"].get.parameters.find((entry) => entry.in === "query" && entry.name === "url" && entry.required === true);
  const canonicalParameter = agentcash.paths["/commerce/payment-offer-preflight"].get.parameters.find((entry) => entry.in === "query" && entry.name === "url" && entry.required === true);
  assert.ok(valuesCanonicallyEqual(parameterExampleValue(aliasParameter), parameterExampleValue(canonicalParameter)));
});

test("credential-free unpaid 402 constructibility canary: all 25 AgentCash paid method-routes construct from generated examples and receive HTTP 402", { timeout: 90_000 }, async (t) => {
  // Transport canary only: constructibility from generated examples, no
  // credential/payment headers, HTTP 402, no top-level success envelope, no
  // reported charge, and no Set-Cookie. This is not proof that a business
  // handler, outbound request, persistent mutation, or other application
  // effect did not run before the 402.
  const base = await bootServer(t);
  const document = await readJson(base, "/openapi.json");
  const routes = paidMethodRoutesOf(document);
  assert.equal(routes.length, EXPECTED_PAID_METHOD_ROUTE_COUNTS.agentcash);

  const outcomes = [];
  for (const route of routes) {
    const [method, pathname] = route.split(" ");
    const operation = document.paths[pathname][method.toLowerCase()];
    let url = `${base}${pathname}`;
    const init = { method, headers: {}, redirect: "manual" };
    if (method === "GET") {
      const query = new URLSearchParams();
      for (const parameter of (operation.parameters || []).filter((entry) => entry.in === "query" && entry.required === true)) {
        const example = parameterExampleValue(parameter);
        assert.ok(isScalarQueryValue(example), `${route}: generated example is not a constructible scalar`);
        query.set(parameter.name, String(example));
      }
      url = `${url}?${query.toString()}`;
    } else {
      const body = operation.requestBody?.content?.["application/json"]?.example;
      assert.ok(body && typeof body === "object", `${route}: generated body example missing`);
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    // Zero credentials, wallet, signer, settlement, or payment material is sent.
    const sentHeaderNames = Object.keys(init.headers).map((name) => name.toLowerCase());
    assert.deepEqual(sentHeaderNames.filter((name) => ["authorization", "cookie", "x-payment", "payment-signature", "x-api-key"].includes(name)), []);
    assert.equal(Object.hasOwn(init, "body") && /"privateKey"|"mnemonic"|"secret"/i.test(String(init.body || "")), false);
    const response = await fetch(url, init);
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    assert.equal(response.status, 402, `${route}: expected an unpaid 402 challenge`);
    assert.ok(body && typeof body === "object", `${route}: 402 challenge body is not JSON`);
    let headerChallenge = "";
    const paymentRequired = response.headers.get("payment-required");
    if (paymentRequired) {
      try { headerChallenge = Buffer.from(paymentRequired, "base64").toString("utf8"); } catch { headerChallenge = ""; }
    }
    const challengeMaterial = `${JSON.stringify(body)}\n${headerChallenge}\n${response.headers.get("www-authenticate") || ""}`;
    assert.match(challengeMaterial, /accepts|offers|payment|x402/i, `${route}: 402 carries no payment challenge`);
    // Application success is a 200 envelope (`ok: true` plus a product decision).
    // A 402 challenge may advertise those strings inside output-schema examples
    // or carry the offer only in PAYMENT-REQUIRED. These assertions cover the
    // unpaid transport envelope only; they do not prove handler non-execution.
    assert.notEqual(body.ok, true, `${route}: unpaid request produced application success output`);
    assert.equal(body.decision, undefined, `${route}: unpaid request produced an application decision`);
    assert.ok(!response.headers.get("set-cookie"), `${route}: unpaid challenge tried to set credential state`);
    assert.notEqual(body.charged, true, `${route}: unpaid challenge reported a charge`);
    outcomes.push({ route, status: response.status });
  }
  assert.equal(outcomes.length, 25);
  assert.equal(outcomes.filter((entry) => entry.status === 402).length, 25);
});

test("CIRCLE_GATEWAY_ENABLED=false boots and derives 24/24 inventories from enabled mounted surfaces", { timeout: 90_000 }, async (t) => {
  const base = await bootServer(t, { CIRCLE_GATEWAY_ENABLED: "false" });
  const catalog = await readJson(base, "/api/actions");
  assert.equal(catalog.actions.length, 22);

  for (const [profile, route, expectedCount] of [
    ["agentcash", "/openapi.json", EXPECTED_ENABLED_SURFACE_COUNTS.agentcashCircleDisabled],
    ["mpp", "/mpp-openapi.json", EXPECTED_ENABLED_SURFACE_COUNTS.mpp],
  ]) {
    const document = await readJson(base, route);
    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.version, "1.23.20");
    const expectedRoutes = expectedPaidMethodRoutes({ profile, circleGatewayEnabled: false });
    assert.equal(expectedRoutes.length, expectedCount);
    assert.deepEqual(paidMethodRoutesOf(document), expectedRoutes);
    assert.equal(document.paths["/gateway/commerce/payment-offer-preflight"], undefined);
    assert.deepEqual(collectOpenApiRequestExampleFindings({
      document,
      actions: catalog.actions,
      expectedPaidMethodRoutes: expectedRoutes,
    }), []);
  }
});
