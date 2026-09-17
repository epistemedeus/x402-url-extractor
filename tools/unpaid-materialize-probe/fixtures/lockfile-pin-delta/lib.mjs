import { openSync, readSync, closeSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMAS, evaluateListingIdentity } from "agent-payment-policy";
import {
  auditCoinbaseMaterialization,
  normalizeDiscoverabilityAuditInput,
} from "../../../../agent-discoverability-audit.mjs";
import { compareDiscoveryLive } from "../../../../discovery-drift.mjs";
import {
  LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC,
  LOCKFILE_PIN_DELTA_METHOD,
  LOCKFILE_PIN_DELTA_PATH,
} from "../../../../lockfile-pin-delta-config.mjs";

export const LOCKFILE_PIN_DELTA_UNPAID_SCHEMA = "samedaydesk.lockfile-pin-delta-unpaid-probe.v0";
export const LOCKFILE_PIN_DELTA_ORIGIN = "https://agents.samedaydesk.com";
export const LOCKFILE_PIN_DELTA_RESOURCE = `${LOCKFILE_PIN_DELTA_ORIGIN}${LOCKFILE_PIN_DELTA_PATH}`;
export const LOCKFILE_PIN_DELTA_MCP_TOOL = "lockfile_pin_delta";
export const EXPECTED_AMOUNT_ATOMIC = LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC;
export const EXPECTED_PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
export const EXPECTED_NETWORK = "eip155:8453";
export const EXPECTED_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_FIXTURE_BYTES = 250_000;
const INVENTED_FIELDS = Object.freeze(["loyaltyPoints", "throughBlock", "buyerEmail"]);
const REFUSED_FLAGS = Object.freeze(["live", "refresh", "cdp", "poll", "reindex", "watch", "daemon", "cron", "pay"]);
const DEMAND_CLAIM_KEYS = Object.freeze(["treatAbsenceAsDemand", "absenceIsDemand", "catalogAbsenceIsDemand"]);

export const BUNDLED_CASES = Object.freeze({
  "empty-search": join(HERE, "empty-search.json"),
  "treat-absence-as-demand": join(HERE, "treat-absence-as-demand.json"),
  "amount-mismatch": join(HERE, "amount-mismatch.json"),
  "invented-field": join(HERE, "invented-field.json"),
  "unpaid-402": join(HERE, "unpaid-402.json"),
});

export const EMPTY_SEARCH_COMMAND =
  "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs empty-search";
export const TREAT_ABSENCE_AS_DEMAND_COMMAND =
  "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs treat-absence-as-demand";
export const AMOUNT_MISMATCH_COMMAND =
  "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs amount-mismatch";
export const INVENTED_FIELD_COMMAND =
  "node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs invented-field";

const BOUNDARY_CLAIM =
  "Unpaid POST /lockfile-pin-delta 402 amount 5000 plus empty exact-resource search is route_absent, not demand. This fixture gate does not pay, refresh Bazaar as owner, poll CDP, or treat catalog absence as buyer demand.";

export class LockfilePinDeltaUnpaidProbeError extends Error {
  constructor(message, { code = "lockfile_pin_delta_unpaid_probe_failed" } = {}) {
    super(message);
    this.name = "LockfilePinDeltaUnpaidProbeError";
    this.code = code;
  }
}

function fail(message, code = "invalid_fixture") {
  throw new LockfilePinDeltaUnpaidProbeError(message, { code });
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

export function inventedReceiptFields(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) inventedReceiptFields(item, found);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (INVENTED_FIELDS.includes(key)) found.add(key);
      inventedReceiptFields(child, found);
    }
  }
  return [...found];
}

export function demandClaim(fixture) {
  if (!fixture || typeof fixture !== "object") return null;
  for (const key of DEMAND_CLAIM_KEYS) {
    if (fixture[key] === true) return key;
  }
  if (fixture.catalogAbsence === "demand") return "catalogAbsence";
  if (fixture.verdict === "demand" || fixture.verdict === "buyer_demand") return "verdict";
  if (Array.isArray(fixture.states) && fixture.states.some((state) => String(state).toLowerCase().includes("demand"))) {
    return "states";
  }
  return null;
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

export function inspectWrapper(wrapper = {}) {
  if (wrapper && typeof wrapper !== "object") fail("wrapper must be an object");
  const charged = wrapper?.charged;
  const wwwAuthenticate = wrapper?.wwwAuthenticate ?? null;
  return Object.freeze({
    charged: charged === false ? false : charged === true ? true : null,
    httpStatus: Number.isInteger(wrapper?.httpStatus) ? wrapper.httpStatus : null,
    conformant: charged === false,
    wwwAuthenticate,
    x402Only: wwwAuthenticate == null || wwwAuthenticate === "",
    claim: "Unpaid wrapper evidence must stay charged:false and must not send MPP WWW-Authenticate. This probe does not pay.",
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
    aliasCandidateCount: primary?.aliasCandidateCount ?? 0,
    ownershipProven: false,
    identityBasis: "evaluateListingIdentity",
    nextAction: report.nextAction,
    evidenceBoundary: primary?.evidenceBoundary || report.boundary?.statement || null,
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
    method: fixture.method || LOCKFILE_PIN_DELTA_METHOD,
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

function observedAmounts(fixture) {
  const amounts = [];
  const push = (value) => {
    if (value === undefined || value === null || value === "") return;
    amounts.push(String(value));
  };
  push(fixture.unpaidOffer?.amountAtomic);
  push(fixture.unpaidOffer?.amount);
  push(fixture.mcp?.amountAtomic);
  push(fixture.mcp?.amount);
  for (const accept of fixture.unpaidOffer?.accepts || fixture.accepts || []) {
    push(accept?.amount);
    push(accept?.amountAtomic);
  }
  for (const offer of fixture.discoveryDrift?.live?.offers || []) {
    push(offer?.amountAtomic);
  }
  return [...new Set(amounts)];
}

function emptyCatalog(fixture) {
  const resources = fixture.catalogSearch?.resources;
  const records = fixture.listingIdentity?.records;
  return Array.isArray(resources) && resources.length === 0
    && (!Array.isArray(records) || records.length === 0);
}

function assertOfflineFixture(fixture) {
  if (fixture.live === true || fixture.pollCdp === true || fixture.ownerRefresh === true || fixture.refresh === true) {
    fail("fixture must not request a live CDP poll or owner catalog refresh", "owner_refresh_refused");
  }
}

function assertLockfileTarget(fixture) {
  if (fixture.origin !== LOCKFILE_PIN_DELTA_ORIGIN) fail("fixture origin must be the SameDayDesk canonical origin", "wrong_origin");
  if (fixture.route !== LOCKFILE_PIN_DELTA_PATH) fail("fixture route must be /lockfile-pin-delta", "wrong_route");
  if (String(fixture.method || LOCKFILE_PIN_DELTA_METHOD).toUpperCase() !== LOCKFILE_PIN_DELTA_METHOD) {
    fail("fixture method must be POST", "wrong_method");
  }
}

function reportBase(fixture, extra) {
  return Object.freeze({
    schemaVersion: LOCKFILE_PIN_DELTA_UNPAID_SCHEMA,
    resource: LOCKFILE_PIN_DELTA_RESOURCE,
    method: LOCKFILE_PIN_DELTA_METHOD,
    expectedAmountAtomic: EXPECTED_AMOUNT_ATOMIC,
    charged: false,
    demand: false,
    fixtureId: fixture.id ?? null,
    ...extra,
  });
}

export function probeExitCode(report) {
  if (!report || report.ok !== true) return 1;
  return 0;
}

export async function runLockfilePinDeltaUnpaidProbe(fixture, {
  now = Date.now(),
  fetchImpl,
} = {}) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) fail("fixture must be an object");
  assertOfflineFixture(fixture);
  assertLockfileTarget(fixture);
  if (!Number.isFinite(now)) fail("now must be a finite epoch millisecond value", "invalid_args");

  const invented = inventedReceiptFields(fixture);
  if (invented.length) {
    return reportBase(fixture, {
      ok: false,
      code: "invented_receipt_field",
      verdict: "invented_receipt_field",
      invented,
      claim: `invented receipt field without live schema: ${invented.join(",")}`,
      notClaimed: Object.freeze(["did not accept invented receipt fields as live 402 terms"]),
      boundary: Object.freeze({ paymentSent: false, cdpPolled: false, ownerRefreshPerformed: false, charged: false, claim: BOUNDARY_CLAIM }),
    });
  }

  const claimedDemand = demandClaim(fixture);
  if (claimedDemand) {
    return reportBase(fixture, {
      ok: false,
      code: "treat_absence_as_demand",
      verdict: "treat_absence_as_demand",
      demandClaim: claimedDemand,
      claim: "catalog absence is route_absent, not buyer demand",
      notClaimed: Object.freeze(["did not treat catalog absence as demand"]),
      boundary: Object.freeze({ paymentSent: false, cdpPolled: false, ownerRefreshPerformed: false, charged: false, claim: BOUNDARY_CLAIM }),
    });
  }

  const amounts = observedAmounts(fixture);
  const mismatched = amounts.filter((amount) => amount !== EXPECTED_AMOUNT_ATOMIC);
  if (mismatched.length) {
    return reportBase(fixture, {
      ok: false,
      code: "amount_mismatch",
      verdict: "amount_mismatch",
      observedAmounts: Object.freeze(amounts),
      claim: `unpaid amount must be string-exact ${EXPECTED_AMOUNT_ATOMIC}; observed ${mismatched.join(",")}`,
      unitsConverted: false,
      notClaimed: Object.freeze(["did not convert units", "did not send payment"]),
      boundary: Object.freeze({ paymentSent: false, cdpPolled: false, ownerRefreshPerformed: false, charged: false, unitsConverted: false, claim: BOUNDARY_CLAIM }),
    });
  }

  const wrapper = inspectWrapper(fixture.wrapper ?? { charged: false });
  if (wrapper.wwwAuthenticate && /^Payment\b/i.test(String(wrapper.wwwAuthenticate))) {
    return reportBase(fixture, {
      ok: false,
      code: "mpp_not_x402_only",
      verdict: "mpp_not_x402_only",
      wrapper,
      claim: "POST /lockfile-pin-delta is x402-only; MPP WWW-Authenticate is not accepted",
      notClaimed: Object.freeze(["did not send payment"]),
      boundary: Object.freeze({ paymentSent: false, cdpPolled: false, ownerRefreshPerformed: false, charged: false, claim: BOUNDARY_CLAIM }),
    });
  }

  const resource = `${fixture.origin}${fixture.route}`;
  const bazaarTracker = inspectBazaarTrackerState(fixture.bazaarTracker, resource);
  const listingIdentity = evaluateIdentity(fixture, now);
  const materialization = await evaluateMaterialization(fixture, {
    fetchImpl: fetchImpl || createFixtureFetch(fixture),
  });
  const discoveryDrift = evaluateDrift(fixture, now);
  const parts = { wrapper, materialization, listingIdentity, discoveryDrift, bazaarTracker };
  const states = collectStates(parts);
  const catalogMiss = emptyCatalog(fixture)
    || listingIdentity.status === "route_absent"
    || listingIdentity.decision === "absent"
    || materialization?.catalog?.exactResourceFound === false;
  const code = wrapper.charged !== false ? "wrapper_nonconforming"
    : discoveryDrift.status === "mismatch" ? "amount_mismatch"
    : catalogMiss ? "route_absent"
    : materialization?.state === "provider_accepted_not_materialized" ? "route_absent"
    : listingIdentity.decision === "canonical" && wrapper.charged === false ? "canonical"
    : "observed";
  const verdict = materialization?.state === "provider_accepted_not_materialized"
    ? "provider_accepted_not_materialized"
    : code;
  const ok = code === "canonical"
    && wrapper.charged === false
    && bazaarTracker.liveRefresh === false
    && bazaarTracker.cdpPolled === false
    && bazaarTracker.ownerRefresh === false;
  return reportBase(fixture, {
    ok,
    code,
    verdict,
    states,
    checkedAt: new Date(now).toISOString(),
    httpStatus: wrapper.httpStatus,
    amountAtomic: amounts[0] || EXPECTED_AMOUNT_ATOMIC,
    x402Only: wrapper.x402Only,
    wwwAuthenticate: wrapper.wwwAuthenticate,
    catalogMiss,
    materialization,
    listingIdentity,
    discoveryDrift,
    bazaarTracker,
    wrapper,
    get: fixture.get ?? null,
    mcp: fixture.mcp ?? null,
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
  return `SameDayDesk unpaid POST /lockfile-pin-delta fixture gate

Fixture-only. Not a hosted route, daemon, collector, or paid service.
Credential-free. No payment. No CDP poll. No owner Bazaar refresh.
Empty exact-resource search is route_absent, not demand.

${EMPTY_SEARCH_COMMAND}
${TREAT_ABSENCE_AS_DEMAND_COMMAND}
${AMOUNT_MISMATCH_COMMAND}
${INVENTED_FIELD_COMMAND}
node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs unpaid-402

Replay a caller-supplied fixture:
  node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs replay --fixture <file>

Exit 1 for route_absent, treat_absence_as_demand, amount_mismatch, and invented_receipt_field.
Exit 0 only when listing identity is canonical and the unpaid wrapper stays charged:false.
Exit 2 for refused flags or invalid usage. --live, --refresh, --cdp, --poll, and --pay are refused.
`;
}

export async function runLockfilePinDeltaUnpaidCli(argv = process.argv.slice(2), {
  stdout = console.log,
  stderr = console.error,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    stdout(usage());
    return argv.length === 0 ? 2 : 0;
  }
  const refused = refusedFlag(argv);
  if (refused) fail(`${refused} is refused: this probe does not poll CDP, pay, or refresh Bazaar as owner`, "owner_refresh_refused");
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
  const report = await runLockfilePinDeltaUnpaidProbe(fixture, { now });
  stdout(JSON.stringify(report, null, 2));
  return probeExitCode(report);
}

export function bundledCaseSource(name) {
  return JSON.parse(readFileSync(BUNDLED_CASES[name], "utf8"));
}

