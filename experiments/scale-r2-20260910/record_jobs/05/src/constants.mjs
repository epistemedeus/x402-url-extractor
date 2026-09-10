/**
 * R2-RECORD-JOBS-05 — Public route regression report constants.
 *
 * Compares TWO caller-supplied route snapshots (baseline + current).
 * No crawl of the entire internet; claims are bounded to the supplied pair.
 *
 * Forbidden spirit: no SEO rank, traffic projection, invest advice,
 * or "site health score" marketing claims.
 */

export const REUSE_FROM = "R2-RECORD-JOBS-05";

export const SCHEMA = "x402.r2.record.route_regression_report.v1";
export const INPUT_SCHEMA = "x402.r2.record.route_regression_input.v1";

export const REPORT_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL_INPUT: "partial_input",
  REJECTED: "rejected",
});

/** Per-route delta classifications. */
export const ROUTE_DELTA = Object.freeze({
  UNCHANGED: "unchanged",
  REMOVED: "removed",
  REDIRECTED: "redirected",
  INACCESSIBLE: "inaccessible",
  RESTORED: "restored",
  STATUS_CHANGED: "status_changed",
  ADDED: "added",
});

/**
 * Caller-supplied accessibility flags on a route observation.
 * Keep `ok` distinct from error-like states.
 */
export const ACCESSIBILITY = Object.freeze({
  OK: "ok",
  FORBIDDEN: "forbidden",
  TIMEOUT: "timeout",
  DNS: "dns",
  ERROR: "error",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  MISSING_REQUIREMENT: "missing_requirement",
  FORBIDDEN_CLAIM: "forbidden_claim",
});

/**
 * Reject inputs that invent SEO / traffic / invest / site-health marketing claims.
 */
export const FORBIDDEN_FIELDS = Object.freeze([
  "seoRank",
  "seoScore",
  "seoRanking",
  "rankingScore",
  "rankScore",
  "universalRank",
  "trafficProjection",
  "trafficEstimate",
  "trafficScore",
  "pageViews",
  "organicTraffic",
  "investmentRecommendation",
  "buySellAdvice",
  "investAdvice",
  "siteHealthScore",
  "healthScore",
  "siteHealth",
  "reputation",
  "reputationScore",
  "revenue",
  "revenueProjection",
]);

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const SCOPE_NOTE =
  "Report covers only the supplied baseline+current route snapshot pair. This is not a claim about the entire internet.";

export const DRY_RUN_NOTE =
  "Fixture/snapshot compare only: never crawl live sites; never invent unobserved routes.";
