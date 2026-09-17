#!/usr/bin/env node

import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  isEIP712SignedReceipt,
  verifyReceiptSignatureEIP712,
} from "@x402/extensions/offer-receipt";
import { SCHEMAS, evaluateListingIdentity } from "agent-payment-policy";

import {
  auditCoinbaseMaterialization,
  normalizeDiscoverabilityAuditInput,
} from "../../agent-discoverability-audit.mjs";
import { compareDiscoveryLive } from "../../discovery-drift.mjs";
import {
  AttemptReceiptError,
  validateAttemptReceipt,
} from "../../examples/customer-x402/src/attempt-receipt.mjs";

export const COMMERCE_FIXTURE_PRODUCT = "samedaydesk-x402-commerce-fixtures";
export const COMMERCE_FIXTURE_VERSION = "1.0.0";
export const UNPAID_MATERIALIZE_SCHEMA = "samedaydesk.commerce-unpaid-materialize-report.v1";
export const WRAPPER_SCHEMA = "samedaydesk.commerce-wrapper-report.v1";
export const RECEIPT_SCHEMA = "samedaydesk.commerce-receipt-report.v1";
export const SDS_EXTRACT = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  route: "/extract",
  resource: "https://agents.samedaydesk.com/extract",
  settlementIdentity: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  amountAtomic: "5000",
});

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_FIXTURE_BYTES = 250_000;
const REFUSED_FLAGS = Object.freeze(["live", "refresh", "cdp", "poll", "reindex", "watch", "daemon", "cron"]);
const FAILURE_STATES = Object.freeze([
  "wrapper_nonconforming",
  "provider_accepted_not_materialized",
  "seller_not_provider_eligible",
  "route_absent",
  "mismatch",
  "listing_identity_conflict",
  "charged:true",
  "two_paywall",
  "foreign_receipt_signer",
  "invalid_receipt_signature",
  "secret_material_refused",
]);
const BOUNDARY = Object.freeze({
  credentialsUsed: false,
  paymentSigned: false,
  paymentSent: false,
  walletAccessed: false,
  redirectsFollowed: false,
  unitsConverted: false,
  reindexPerformed: false,
  ownerRefreshPerformed: false,
  cdpPolled: false,
  registryMutated: false,
  checkoutMutated: false,
  charged: false,
});

export class CommerceFixtureError extends Error {
  constructor(message, { code = "commerce_fixture_failed" } = {}) {
    super(message);
    this.name = "CommerceFixtureError";
    this.code = code;
  }
}

function fail(message, code = "invalid_fixture") {
  throw new CommerceFixtureError(message, { code });
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function lowerAddr(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createFixtureFetch(fixture) {
  return async (url) => {
    const target = String(url);
    if (target.includes("/x402/validate")) return jsonResponse(fixture.validator ?? {});
    if (target.includes("/x402/discovery/search")) {
      return jsonResponse(fixture.catalogSearch ?? { resources: [] });
    }
    fail(`refused non-fixture fetch: ${target}`, "cdp_poll_refused");
  };
}

export function loadFixture(path) {
  const fd = openSync(resolve(path), "r");
  try {
    const bytes = Buffer.alloc(MAX_FIXTURE_BYTES + 1);
    let size = 0;
    let count;
    while (size < bytes.length && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) {
      size += count;
    }
    if (size > MAX_FIXTURE_BYTES) fail("fixture exceeds size cap", "fixture_too_large");
    const value = JSON.parse(bytes.subarray(0, size).toString("utf8"));
    if (!asRecord(value)) fail("fixture must be an object");
    return value;
  } finally {
    closeSync(fd);
  }
}

function assertOfflineFixture(fixture) {
  if (fixture.live === true || fixture.pollCdp === true || fixture.ownerRefresh === true || fixture.refresh === true) {
    fail("fixture must not request a live CDP poll or owner catalog refresh", "owner_refresh_refused");
  }
  if (fixture.liveListing === true) fail("live listings are refused", "live_listing");
}

export function inspectWrapper(wrapper = {}) {
  if (wrapper && typeof wrapper !== "object") fail("wrapper must be an object");
  const charged = wrapper?.charged;
  return Object.freeze({
    charged: charged === false ? false : charged === true ? true : null,
    httpStatus: Number.isInteger(wrapper?.httpStatus) ? wrapper.httpStatus : null,
    conformant: charged === false,
    claim: "Unpaid wrapper evidence must stay charged:false. This driver does not pay, sign, or reach a facilitator.",
  });
}

function collectTrackerRoutes(document) {
  const routes = [];
  for (const source of Object.values(document?.sources ?? {})) {
    for (const seller of Object.values(source?.sellers ?? {})) {
      routes.push(...Object.keys(seller?.routes ?? {}));
    }
  }
  return [...new Set(routes)];
}

export function inspectBazaarTrackerState(document, resource) {
  if (document === undefined || document === null) {
    return Object.freeze({
      requested: false,
      mode: "omitted",
      liveRefresh: false,
      cdpPolled: false,
      ownerRefresh: false,
      routePresent: null,
    });
  }
  if (!asRecord(document)) fail("bazaarTracker must be an object");
  if (document.live === true || document.refresh === true || document.pollCdp === true || document.ownerRefresh === true) {
    fail("bazaar-tracker live refresh and CDP poll are refused", "owner_refresh_refused");
  }
  const routes = collectTrackerRoutes(document);
  return Object.freeze({
    requested: true,
    mode: "readback",
    liveRefresh: false,
    cdpPolled: false,
    ownerRefresh: false,
    routeCount: routes.length,
    routePresent: resource ? routes.includes(resource) : null,
  });
}

function compactListingIdentity(report) {
  const primary = report.sources[0] || null;
  const status = primary?.status ?? (report.decision === "absent" ? "route_absent" : null);
  return Object.freeze({
    available: true,
    schemaVersion: report.schemaVersion,
    decision: report.decision,
    status,
    exactRouteRecordCount: primary?.exactRouteRecordCount ?? 0,
    canonicalRecordCount: primary?.canonicalRecordCount ?? 0,
    canonicalOriginMatched: primary?.canonicalOriginMatched === true,
    ownershipProven: false,
  });
}

function evaluateIdentity(fixture, now) {
  const input = fixture.listingIdentity;
  if (!input) return Object.freeze({ available: false, reason: "listing_identity_omitted" });
  const report = evaluateListingIdentity({
    schemaVersion: SCHEMAS.listingIdentityObservation,
    target: {
      canonicalOrigin: input.canonicalOrigin,
      route: input.route,
      ...(input.settlementIdentity ? { settlementIdentity: input.settlementIdentity } : {}),
    },
    sources: Array.isArray(input.sources) ? input.sources : [],
    records: Array.isArray(input.records) ? input.records : [],
  }, { now });
  return compactListingIdentity(report);
}

async function evaluateMaterialization(fixture, { fetchImpl }) {
  if (fixture.validator === undefined && fixture.catalogSearch === undefined) {
    return Object.freeze({ requested: false });
  }
  const input = normalizeDiscoverabilityAuditInput({
    origin: fixture.origin,
    intent: fixture.intent,
    route: fixture.route,
    method: fixture.method || "GET",
    materializationAudit: true,
  });
  return auditCoinbaseMaterialization(input, { fetchImpl });
}

function evaluateDrift(fixture, now) {
  const pair = fixture.discoveryDrift;
  if (!pair) return Object.freeze({ requested: false, status: "not_requested" });
  if (!pair.catalog || !pair.live) fail("discoveryDrift requires catalog and live observations");
  const report = compareDiscoveryLive(pair.catalog, pair.live, { now });
  const amount = report.dimensions.find((item) => item.dimension === "amountAtomic") || null;
  return Object.freeze({
    requested: true,
    status: report.status,
    observedMatch: report.observedMatch,
    amountAtomic: amount,
  });
}

function collectCharges(fixture) {
  const charges = [];
  const seen = new Set();
  const push = (charge) => {
    if (!asRecord(charge)) return;
    const payTo = lowerAddr(charge.payTo || charge.x402WalletAddress);
    const resource = charge.resource || charge.resourceUrl || null;
    const amountAtomic = charge.amountAtomic == null ? null : String(charge.amountAtomic);
    const key = `${charge.role || ""}|${resource}|${payTo || ""}|${amountAtomic || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    charges.push({ role: charge.role || "unknown", resource, amountAtomic, payTo });
  };
  if (Array.isArray(fixture.charges) && fixture.charges.length > 0) {
    for (const charge of fixture.charges) push(charge);
    return charges;
  }
  const observed = asRecord(fixture.observed402) || {};
  for (const [role, challenge] of Object.entries(observed)) {
    if (!asRecord(challenge)) continue;
    push({
      role,
      resource: challenge.resource || challenge.resourceUrl,
      amountAtomic: challenge.amountAtomic,
      payTo: challenge.payTo,
    });
  }
  return charges;
}

function collectStates({ wrapper, materialization, listingIdentity, discoveryDrift, charges }) {
  const states = [];
  if (wrapper.charged === false) states.push("charged:false");
  if (wrapper.charged === true) states.push("charged:true");
  if (wrapper.conformant === false) states.push("wrapper_nonconforming");
  if (materialization?.state) states.push(materialization.state);
  if (listingIdentity?.status) states.push(listingIdentity.status);
  if (listingIdentity?.decision && listingIdentity.decision !== listingIdentity.status) {
    states.push(listingIdentity.decision);
  }
  if (discoveryDrift?.requested && discoveryDrift.status && discoveryDrift.status !== "not_requested") {
    states.push(discoveryDrift.status);
  }
  if (Array.isArray(charges) && charges.length >= 2) {
    const owners = new Set(charges.map((row) => row.payTo).filter(Boolean));
    if (owners.size >= 2) states.push("two_paywall");
  }
  return Object.freeze([...new Set(states)]);
}

function deriveUnpaidVerdict(states, parts) {
  if (parts.wrapper.charged !== false) return "wrapper_nonconforming";
  if (parts.materialization?.state === "provider_accepted_not_materialized") {
    return "provider_accepted_not_materialized";
  }
  if (parts.discoveryDrift?.status === "mismatch") return "mismatch";
  if (parts.listingIdentity?.status === "route_absent" || parts.listingIdentity?.decision === "absent") {
    return "route_absent";
  }
  if (parts.listingIdentity?.decision === "review_required") return "listing_identity_conflict";
  if (parts.materialization?.state === "seller_not_provider_eligible") return "seller_not_provider_eligible";
  if (parts.materialization?.state === "unresolved") return "unresolved";
  if (parts.listingIdentity?.decision === "canonical" && parts.listingIdentity?.status === "canonical") {
    return "canonical";
  }
  return "observed";
}

function claimsRejected(fixture, ok) {
  return fixture?.claims?.ok === true && ok !== true;
}

export async function runUnpaidMaterialize(fixture, { now = Date.now(), fetchImpl } = {}) {
  if (!asRecord(fixture)) fail("fixture must be an object");
  assertOfflineFixture(fixture);
  const origin = fixture.origin;
  const route = fixture.route;
  if (typeof origin !== "string" || typeof route !== "string") fail("fixture origin and route are required");
  const resource = `${origin}${route}`;
  const wrapper = inspectWrapper(fixture.wrapper ?? { charged: false });
  const bazaarTracker = inspectBazaarTrackerState(fixture.bazaarTracker, resource);
  const listingIdentity = evaluateIdentity(fixture, now);
  const materialization = await evaluateMaterialization(fixture, {
    fetchImpl: fetchImpl || createFixtureFetch(fixture),
  });
  const discoveryDrift = evaluateDrift(fixture, now);
  const charges = collectCharges(fixture);
  const parts = { wrapper, materialization, listingIdentity, discoveryDrift, bazaarTracker, charges };
  const states = collectStates(parts);
  const verdict = deriveUnpaidVerdict(states, parts);
  const ok = !FAILURE_STATES.some((state) => states.includes(state) || verdict === state)
    && wrapper.charged === false
    && bazaarTracker.liveRefresh === false
    && bazaarTracker.cdpPolled === false;
  return Object.freeze({
    schemaVersion: UNPAID_MATERIALIZE_SCHEMA,
    product: COMMERCE_FIXTURE_PRODUCT,
    version: COMMERCE_FIXTURE_VERSION,
    plane: "unpaid-materialize",
    ok,
    charged: false,
    verdict,
    states,
    fixtureId: fixture.id ?? null,
    resource,
    materialization,
    listingIdentity,
    discoveryDrift,
    bazaarTracker,
    wrapper,
    claimsRejected: claimsRejected(fixture, ok),
    reused: Object.freeze([
      "evaluateListingIdentity",
      "auditCoinbaseMaterialization",
      "compareDiscoveryLive",
      "charged:false",
    ]),
    notClaimed: Object.freeze([
      "did not treat catalog absence as demand",
      "did not refresh Bazaar as owner",
      "did not poll CDP",
      "did not send payment",
    ]),
    boundary: BOUNDARY,
  });
}

export function runWrapper(fixture) {
  if (!asRecord(fixture)) fail("fixture must be an object");
  assertOfflineFixture(fixture);
  const wrapper = inspectWrapper(fixture.wrapper ?? { charged: false });
  const charges = collectCharges(fixture);
  const owners = [...new Set(charges.map((row) => row.payTo).filter(Boolean))];
  const states = collectStates({ wrapper, charges });
  let verdict = "observed";
  if (wrapper.charged !== false) verdict = "wrapper_nonconforming";
  else if (owners.length >= 2 || charges.length >= 2 && owners.length >= 2) verdict = "two_paywall";
  else if (charges.length === 1 && owners.length === 1 && wrapper.charged === false) verdict = "one_paywall";
  else if (wrapper.charged === false && charges.length === 0) verdict = "one_paywall";
  const ok = verdict === "one_paywall" && wrapper.charged === false && !states.includes("two_paywall");
  return Object.freeze({
    schemaVersion: WRAPPER_SCHEMA,
    product: COMMERCE_FIXTURE_PRODUCT,
    version: COMMERCE_FIXTURE_VERSION,
    plane: "wrapper",
    ok,
    charged: false,
    verdict,
    states,
    fixtureId: fixture.id ?? null,
    paywallCount: Math.max(charges.length, owners.length),
    settlementOwnerCount: owners.length,
    charges,
    wrapper,
    claimsRejected: claimsRejected(fixture, ok),
    boundary: BOUNDARY,
  });
}

export async function runReceipt(fixture) {
  if (!asRecord(fixture)) fail("fixture must be an object");
  assertOfflineFixture(fixture);
  const receipt = asRecord(fixture.receipt) || fixture;
  const kind = String(fixture.kind || "");
  const attemptLike = kind.includes("attempt")
    || receipt.schema === "samedaydesk.customer-x402.attempt-receipt.v1";

  if (attemptLike) {
    try {
      validateAttemptReceipt(receipt);
      return Object.freeze({
        schemaVersion: RECEIPT_SCHEMA,
        product: COMMERCE_FIXTURE_PRODUCT,
        plane: "receipt",
        ok: true,
        verdict: "attempt_receipt_valid",
        code: null,
        fixtureId: fixture.id ?? null,
        claimsRejected: claimsRejected(fixture, true),
        rejected: false,
        boundary: BOUNDARY,
      });
    } catch (error) {
      const code = error instanceof AttemptReceiptError ? error.code : "invalid_attempt_receipt";
      return Object.freeze({
        schemaVersion: RECEIPT_SCHEMA,
        product: COMMERCE_FIXTURE_PRODUCT,
        plane: "receipt",
        ok: false,
        verdict: "forged_receipt_rejected",
        code,
        message: error instanceof Error ? error.message : String(error),
        fixtureId: fixture.id ?? null,
        claimsRejected: true,
        rejected: true,
        boundary: BOUNDARY,
      });
    }
  }

  let supported = false;
  try {
    supported = isEIP712SignedReceipt(receipt);
  } catch {
    supported = false;
  }
  if (!supported) {
    return Object.freeze({
      schemaVersion: RECEIPT_SCHEMA,
      product: COMMERCE_FIXTURE_PRODUCT,
      plane: "receipt",
      ok: false,
      verdict: "forged_receipt_rejected",
      code: "unsupported_receipt_signature_format",
      message: "receipt must use the merchant-supported eip712 receipt format",
      fixtureId: fixture.id ?? null,
      claimsRejected: true,
      rejected: true,
      boundary: BOUNDARY,
    });
  }

  let verified;
  try {
    verified = await verifyReceiptSignatureEIP712(receipt);
  } catch (error) {
    return Object.freeze({
      schemaVersion: RECEIPT_SCHEMA,
      product: COMMERCE_FIXTURE_PRODUCT,
      plane: "receipt",
      ok: false,
      verdict: "forged_receipt_rejected",
      code: "invalid_receipt_signature",
      message: error instanceof Error ? error.message : String(error),
      fixtureId: fixture.id ?? null,
      claimsRejected: true,
      rejected: true,
      formatValid: true,
      boundary: BOUNDARY,
    });
  }

  const merchant = fixture.merchantSigner;
  if (merchant && String(verified.signer).toLowerCase() !== String(merchant).toLowerCase()) {
    return Object.freeze({
      schemaVersion: RECEIPT_SCHEMA,
      product: COMMERCE_FIXTURE_PRODUCT,
      plane: "receipt",
      ok: false,
      verdict: "forged_receipt_rejected",
      code: "foreign_receipt_signer",
      message: "receipt was not signed by the configured merchant receipt signer",
      recoveredSigner: verified.signer,
      merchantSigner: merchant,
      claimedPayer: receipt.payload?.payer ?? null,
      fixtureId: fixture.id ?? null,
      claimsRejected: true,
      rejected: true,
      formatValid: true,
      boundary: BOUNDARY,
    });
  }

  return Object.freeze({
    schemaVersion: RECEIPT_SCHEMA,
    product: COMMERCE_FIXTURE_PRODUCT,
    plane: "receipt",
    ok: true,
    verdict: "merchant_signed",
    recoveredSigner: verified.signer,
    fixtureId: fixture.id ?? null,
    claimsRejected: claimsRejected(fixture, true),
    rejected: false,
    boundary: BOUNDARY,
  });
}

export function classifyFixture(fixture) {
  const schema = String(fixture?.schemaVersion || "");
  const kind = String(fixture?.kind || "");
  if (schema.includes("receipt") || kind.includes("receipt") || asRecord(fixture?.receipt)) return "receipt";
  if (schema.includes("wrapper") || kind === "wrapper" || Array.isArray(fixture?.charges)) return "wrapper";
  return "unpaid-materialize";
}

export async function runCommerceFixture(fixture, { now, fetchImpl, plane } = {}) {
  const resolved = plane || classifyFixture(fixture);
  if (resolved === "receipt") return runReceipt(fixture);
  if (resolved === "wrapper" && !fixture.validator && !fixture.catalogSearch && !fixture.listingIdentity) {
    return runWrapper(fixture);
  }
  if (resolved === "wrapper") {
    const unpaid = await runUnpaidMaterialize(fixture, { now, fetchImpl });
    const wrap = runWrapper(fixture);
    if (wrap.verdict === "two_paywall" || wrap.verdict === "wrapper_nonconforming") return wrap;
    return unpaid;
  }
  return runUnpaidMaterialize(fixture, { now, fetchImpl });
}

export function probeExitCode(report) {
  if (!report || report.ok !== true) return 1;
  return 0;
}

export function refusedFlag(argv) {
  return argv.find((token) => {
    if (!token.startsWith("--")) return false;
    const key = token.slice(2).split("=")[0];
    return REFUSED_FLAGS.includes(key);
  }) || null;
}

export function usage() {
  return `SameDayDesk x402 commerce fixtures (unpaid materialize / wrapper / forged receipt)

Local unpublished fixtures only. Never pays, lists, refreshes Bazaar, or polls CDP.

  node fixtures/commerce/check.mjs fixtures/commerce/unpaid-materialize/seeded-absence.json
  node fixtures/commerce/check.mjs fixtures/commerce/unpaid-materialize/sds-extract-canonical.json
  node fixtures/commerce/check.mjs fixtures/commerce/receipts/forged-offer-receipt.json

Exit 0 only when unpaid wrapper charged:false and catalog reach matches without a forged receipt.
Seeded forged receipts, charged:true wrappers, two-paywall wraps, and validator-accepted empty
search exit 1. --live, --refresh, --cdp, and --poll are refused.
`;
}

export async function runCommerceFixtureCli(argv = process.argv.slice(2), {
  stdout = console.log,
  stderr = console.error,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    stdout(usage());
    return argv.length === 0 ? 2 : 0;
  }
  const refused = refusedFlag(argv);
  if (refused) fail(`${refused} is refused: this driver does not poll CDP or refresh Bazaar as owner`, "owner_refresh_refused");

  let plane = null;
  let fixturePath = argv[0];
  if (["unpaid-materialize", "wrapper", "receipt"].includes(argv[0])) {
    plane = argv[0];
    fixturePath = argv[1];
  }
  if (!fixturePath) fail("fixture path is required", "invalid_args");

  const fixture = loadFixture(fixturePath);
  const now = fixture.now ? Date.parse(fixture.now) : Date.now();
  if (!Number.isFinite(now)) fail("fixture now must be an ISO-8601 timestamp", "invalid_args");
  const report = await runCommerceFixture(fixture, { now, plane });
  stdout(JSON.stringify(report, null, 2));
  return probeExitCode(report);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  try {
    process.exitCode = await runCommerceFixtureCli();
  } catch (error) {
    const payload = {
      ok: false,
      decision: "refuse",
      codes: [error?.code || "commerce_fixture_failed"],
      message: error instanceof Error ? error.message : String(error),
      ...BOUNDARY,
    };
    if (error?.code === "malformed_fixture" || /JSON|no such file|ENOENT/i.test(String(error?.message))) {
      payload.codes = ["malformed_fixture"];
    }
    console.error(JSON.stringify(payload));
    process.exitCode = error?.code === "invalid_args" || error?.code === "owner_refresh_refused" ? 2 : 1;
  }
}

export const MANIFEST_PATH = join(HERE, "MANIFEST.json");
export function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}
