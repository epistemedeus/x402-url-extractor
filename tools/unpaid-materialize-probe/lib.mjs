import { openSync, readSync, closeSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMAS, evaluateListingIdentity } from "agent-payment-policy";
import {
  auditCoinbaseMaterialization,
  normalizeDiscoverabilityAuditInput,
} from "../../agent-discoverability-audit.mjs";
import { compareDiscoveryLive } from "../../discovery-drift.mjs";

export const UNPAID_MATERIALIZE_PRODUCT = "samedaydesk-unpaid-materialize-probe";
export const UNPAID_MATERIALIZE_VERSION = "1.0.0";
export const UNPAID_MATERIALIZE_SCHEMA = "samedaydesk.unpaid-materialize-probe.v1";
export const SDS_BAZAAR_TRACKER_PIN = "775051602d91f42ca1aa920054cfd7a451982940";
export const SDS_BAZAAR_TRACKER_TESTS = 13;

export const SDS_EXTRACT = Object.freeze({
  origin: "https://agents.samedaydesk.com",
  route: "/extract",
  resource: "https://agents.samedaydesk.com/extract",
  settlementIdentity: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
  amountAtomic: "5000",
});

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_FIXTURE_BYTES = 250_000;
const REFUSED_FLAGS = Object.freeze([
  "live",
  "refresh",
  "cdp",
  "poll",
  "reindex",
  "watch",
  "daemon",
  "cron",
]);
export const FAILURE_STATES = Object.freeze([
  "wrapper_nonconforming",
  "provider_accepted_not_materialized",
  "seller_not_provider_eligible",
  "route_absent",
  "mismatch",
  "listing_identity_conflict",
  "charged:true",
]);
export const CATALOG_REACH_GAP_STATES = Object.freeze([
  "provider_accepted_not_materialized",
  "route_absent",
]);
export const AMOUNT_MISMATCH_STATE = "mismatch";
export const REFUSED_OPERATOR_FLAGS = Object.freeze([
  "--live",
  "--refresh",
  "--cdp",
  "--poll",
]);
const BOUNDARY_CLAIM = "Composes existing listing-identity, discovery-drift, charged:false wrapper, and bazaar-tracker readback states. Validator acceptance is not catalog materialization. Catalog absence is not demand. This probe does not refresh Bazaar as owner, poll CDP, reindex, follow redirects, or send payment.";

export const SEEDED_ABSENCE_COMMAND = "node tools/unpaid-materialize-probe/cli.mjs seeded-absence";
export const AMOUNT_MISMATCH_COMMAND = "node tools/unpaid-materialize-probe/cli.mjs amount-mismatch";
export const SDS_EXTRACT_IDENTITY_COMMAND = "node tools/unpaid-materialize-probe/cli.mjs sds-extract-identity";

export const BUNDLED_CASES = Object.freeze({
  "seeded-absence": join(HERE, "fixtures/seeded-absence.json"),
  "amount-mismatch": join(HERE, "fixtures/amount-mismatch.json"),
  "sds-extract-identity": join(HERE, "fixtures/sds-extract-canonical.json"),
});

export const OPERATOR_SURFACE = Object.freeze({
  "seeded-absence": Object.freeze({
    bundled: "seeded-absence",
    fixture: join(HERE, "fixtures/seeded-absence.json"),
    invariant: "catalog-reach-gap",
    claim: "Validator-accepted unpaid 402 plus empty exact-resource search is provider_accepted_not_materialized / route_absent. Catalog absence is not demand.",
    expectedExit: 1,
    expectedVerdict: "provider_accepted_not_materialized",
    expectedStates: Object.freeze(["provider_accepted_not_materialized", "route_absent", "charged:false"]),
  }),
  "amount-mismatch": Object.freeze({
    bundled: "amount-mismatch",
    fixture: join(HERE, "fixtures/amount-mismatch.json"),
    invariant: "amount-mismatch",
    claim: "Atomic catalog 5000 vs live unpaid 10000 is discovery-drift mismatch. Amounts are compared as strings. Units are not converted.",
    expectedExit: 1,
    expectedVerdict: "mismatch",
    expectedStates: Object.freeze(["mismatch", "charged:false", "canonical", "materialized"]),
  }),
  "sds-extract-identity": Object.freeze({
    bundled: "sds-extract-identity",
    fixture: join(HERE, "fixtures/sds-extract-canonical.json"),
    invariant: "listing-identity-canonical",
    claim: "SameDayDesk /extract listing identity is canonical at the declared origin. Canonical origin match is not hostname-ownership proof.",
    expectedExit: 0,
    expectedVerdict: "canonical",
    expectedStates: Object.freeze(["canonical", "charged:false", "match", "materialized"]),
  }),
  "wrapper-charged-true": Object.freeze({
    bundled: null,
    fixture: join(HERE, "fixtures/wrapper-charged-true.json"),
    invariant: "wrapper-charged-false",
    claim: "Unpaid wrapper evidence must stay charged:false. charged:true is wrapper_nonconforming.",
    expectedExit: 1,
    expectedVerdict: "wrapper_nonconforming",
    expectedStates: Object.freeze(["charged:true", "wrapper_nonconforming"]),
  }),
});

export class UnpaidMaterializeProbeError extends Error {
  constructor(message, { code = "unpaid_materialize_probe_failed" } = {}) {
    super(message);
    this.name = "UnpaidMaterializeProbeError";
    this.code = code;
  }
}

function fail(message, code = "invalid_fixture") {
  throw new UnpaidMaterializeProbeError(message, { code });
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
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("fixture must be an object");
    return value;
  } finally {
    closeSync(fd);
  }
}

export function inspectWrapper(wrapper = {}) {
  if (wrapper && typeof wrapper !== "object") fail("wrapper must be an object");
  const charged = wrapper?.charged;
  return Object.freeze({
    charged: charged === false ? false : charged === true ? true : null,
    httpStatus: Number.isInteger(wrapper?.httpStatus) ? wrapper.httpStatus : null,
    conformant: charged === false,
    claim: "Unpaid wrapper evidence must stay charged:false. This probe does not pay, sign, or reach a facilitator.",
  });
}

function collectTrackerRoutes(document) {
  const routes = [];
  for (const source of Object.values(document?.sources ?? {})) {
    for (const seller of Object.values(source?.sellers ?? {})) {
      routes.push(...Object.keys(seller?.routes ?? {}));
    }
  }
  if (Array.isArray(document?.rows)) {
    for (const row of document.rows) {
      if (typeof row?.resource === "string") routes.push(row.resource);
    }
  }
  if (Array.isArray(document?.resources)) {
    for (const row of document.resources) {
      if (typeof row?.resource === "string") routes.push(row.resource);
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
      routeCount: null,
      claim: "No bazaar-tracker document was supplied. This probe does not poll CDP.",
    });
  }
  if (typeof document !== "object" || Array.isArray(document)) fail("bazaarTracker must be an object");
  if (document.live === true || document.refresh === true || document.pollCdp === true || document.ownerRefresh === true) {
    fail("bazaar-tracker live refresh and CDP poll are refused", "owner_refresh_refused");
  }
  const routes = collectTrackerRoutes(document);
  return Object.freeze({
    requested: true,
    mode: "readback",
    schema: document.schema ?? null,
    liveRefresh: false,
    cdpPolled: false,
    ownerRefresh: false,
    routeCount: routes.length,
    routePresent: resource ? routes.includes(resource) : null,
    claim: "Readback of a caller-supplied bazaar-tracker observation. This did not poll CDP or refresh Bazaar as owner.",
  });
}

function compactListingIdentity(report) {
  const primary = report.sources[0] || null;
  const status = primary?.status
    ?? (report.decision === "absent" ? "route_absent" : null);
  return Object.freeze({
    available: true,
    schemaVersion: report.schemaVersion,
    decision: report.decision,
    status,
    exactRouteRecordCount: primary?.exactRouteRecordCount ?? 0,
    canonicalRecordCount: primary?.canonicalRecordCount ?? 0,
    canonicalOriginMatched: primary?.canonicalOriginMatched === true,
    aliasCandidateCount: primary?.aliasCandidateCount ?? 0,
    aliasOrigins: Object.freeze([...(primary?.aliasOrigins || [])]),
    ownershipProven: false,
    identityBasis: "evaluateListingIdentity",
    nextAction: report.nextAction,
    evidenceBoundary: primary?.evidenceBoundary || report.boundary?.statement || null,
  });
}

function evaluateIdentity(fixture, now) {
  const input = fixture.listingIdentity;
  if (!input) {
    return Object.freeze({ available: false, reason: "listing_identity_omitted" });
  }
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
  if (!pair) {
    return Object.freeze({ requested: false, status: "not_requested" });
  }
  if (!pair.catalog || !pair.live) fail("discoveryDrift requires catalog and live observations");
  const report = compareDiscoveryLive(pair.catalog, pair.live, { now });
  const amount = report.dimensions.find((item) => item.dimension === "amountAtomic") || null;
  return Object.freeze({
    requested: true,
    status: report.status,
    observedMatch: report.observedMatch,
    resolvedCause: false,
    amountAtomic: amount,
    listingIdentityAvailable: report.listingIdentity?.available === true,
    boundary: report.boundary,
  });
}

function collectStates({ wrapper, materialization, listingIdentity, discoveryDrift, bazaarTracker }) {
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
  if (bazaarTracker?.requested && bazaarTracker.routePresent === false) states.push("tracker_route_absent");
  if (bazaarTracker?.requested && bazaarTracker.routePresent === true) states.push("tracker_route_present");
  return Object.freeze([...new Set(states)]);
}

function deriveVerdict(states, parts) {
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

export function probeExitCode(report) {
  if (!report) return 1;
  const verdict = report.verdict;
  const states = Array.isArray(report.states) ? report.states : [];
  const catalogReachGap = CATALOG_REACH_GAP_STATES.some(
    (state) => states.includes(state) || verdict === state,
  );
  const amountMismatch = states.includes(AMOUNT_MISMATCH_STATE) || verdict === AMOUNT_MISMATCH_STATE;
  const documentedFailure = FAILURE_STATES.some(
    (state) => states.includes(state) || verdict === state,
  );
  if (catalogReachGap || amountMismatch || documentedFailure || report.ok !== true) return 1;
  return 0;
}

function assertOfflineFixture(fixture) {
  if (fixture.live === true || fixture.pollCdp === true || fixture.ownerRefresh === true || fixture.refresh === true) {
    fail("fixture must not request a live CDP poll or owner catalog refresh", "owner_refresh_refused");
  }
}

export async function runUnpaidMaterializeProbe(fixture, {
  now = Date.now(),
  fetchImpl,
} = {}) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) fail("fixture must be an object");
  assertOfflineFixture(fixture);
  if (!Number.isFinite(now)) fail("now must be a finite epoch millisecond value", "invalid_args");
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
  const parts = { wrapper, materialization, listingIdentity, discoveryDrift, bazaarTracker };
  const states = collectStates(parts);
  const verdict = deriveVerdict(states, parts);
  const ok = !FAILURE_STATES.some((state) => states.includes(state) || verdict === state)
    && wrapper.charged === false
    && bazaarTracker.liveRefresh === false
    && bazaarTracker.cdpPolled === false
    && bazaarTracker.ownerRefresh === false;
  return Object.freeze({
    schemaVersion: UNPAID_MATERIALIZE_SCHEMA,
    product: UNPAID_MATERIALIZE_PRODUCT,
    version: UNPAID_MATERIALIZE_VERSION,
    ok,
    charged: false,
    verdict,
    states,
    checkedAt: new Date(now).toISOString(),
    resource,
    fixtureId: fixture.id ?? null,
    materialization,
    listingIdentity,
    discoveryDrift,
    bazaarTracker,
    wrapper,
    reused: Object.freeze([
      "evaluateListingIdentity",
      "auditCoinbaseMaterialization",
      "compareDiscoveryLive",
      "charged:false",
      "bazaar-tracker readback",
    ]),
    notClaimed: Object.freeze([
      "did not treat catalog absence as demand",
      "did not refresh Bazaar as owner",
      "did not poll CDP",
      "did not reindex any catalog",
      "did not send payment",
      "did not follow redirects",
    ]),
    boundary: Object.freeze({
      credentialsUsed: false,
      paymentSigned: false,
      paymentSent: false,
      redirectsFollowed: false,
      unitsConverted: false,
      reindexPerformed: false,
      ownerRefreshPerformed: false,
      cdpPolled: false,
      charged: false,
      claim: BOUNDARY_CLAIM,
    }),
  });
}

export function refusedFlag(argv) {
  return argv.find((token) => {
    if (!token.startsWith("--")) return false;
    const key = token.slice(2).split("=")[0];
    return REFUSED_FLAGS.includes(key);
  }) || null;
}

export function usage() {
  return `SameDayDesk unpaid materialization and wrapper-conformance probe

Library + CLI. Not a hosted route, daemon, collector, or paid service.
Credential-free. No payment. No CDP poll. No owner Bazaar refresh.

${SEEDED_ABSENCE_COMMAND}
${AMOUNT_MISMATCH_COMMAND}
${SDS_EXTRACT_IDENTITY_COMMAND}

Replay a caller-supplied fixture:
  node tools/unpaid-materialize-probe/cli.mjs replay --fixture tools/unpaid-materialize-probe/fixtures/seeded-absence.json

Exit 0 only when the composed states show catalog reach without amount mismatch
and unpaid wrapper charged:false. Catalog-reach gap (seeded-absence), amount
mismatch (amount-mismatch), and charged:true exit 1, including via replay
--fixture of the same file. --live, --refresh, --cdp, and --poll are refused.

Bazaar-tracker is readback-only (SDS tools/bazaar-tracker @ ${SDS_BAZAAR_TRACKER_PIN},
${SDS_BAZAAR_TRACKER_TESTS} tests). This kit does not fork x402scan or invent a collector.
`;
}

export async function runUnpaidMaterializeCli(argv = process.argv.slice(2), {
  stdout = console.log,
  stderr = console.error,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    stdout(usage());
    return argv.length === 0 ? 2 : 0;
  }
  const refused = refusedFlag(argv);
  if (refused) fail(`${refused} is refused: this probe does not poll CDP or refresh Bazaar as owner`, "owner_refresh_refused");
  const command = argv[0];
  let fixturePath;
  if (BUNDLED_CASES[command]) {
    if (argv.length !== 1) fail("bundled case takes no extra options", "invalid_args");
    fixturePath = BUNDLED_CASES[command];
  } else if (command === "replay") {
    const flag = argv.indexOf("--fixture");
    if (flag < 0 || !argv[flag + 1] || argv.length !== 3) {
      fail("replay requires --fixture <file>", "invalid_args");
    }
    fixturePath = argv[flag + 1];
  } else {
    fail(`unknown command ${command}`, "invalid_args");
  }
  const fixture = loadFixture(fixturePath);
  const now = fixture.now ? Date.parse(fixture.now) : Date.now();
  if (!Number.isFinite(now)) fail("fixture now must be an ISO-8601 timestamp", "invalid_args");
  const report = await runUnpaidMaterializeProbe(fixture, { now });
  stdout(JSON.stringify(report, null, 2));
  return probeExitCode(report);
}

export function bundledCaseSource(name) {
  return JSON.parse(readFileSync(BUNDLED_CASES[name], "utf8"));
}
