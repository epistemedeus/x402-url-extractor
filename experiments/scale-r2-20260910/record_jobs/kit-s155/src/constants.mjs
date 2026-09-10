/**
 * S155 source-record job kit — one package, one journey over Heavy 01..04 + native 05..08.
 * Offline / fixtures only. Does not reimplement OpenAPI/pricing/CSV/feed parsers.
 * Heavy root: HEAVY_S134_ROOT → default S154 pin 65ce1867 worktree.
 */

export const SCHEMA = "x402.r2.record.source_record_kit.v1";
export const INPUT_SCHEMA = "x402.r2.record.kit_request.v1";
export const MANIFEST_SCHEMA = "x402.r2.record.kit_manifest.v1";
export const JOURNEY_SCHEMA = "x402.r2.record.kit_journey.v1";

export const KIT_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL: "partial",
  REJECTED: "rejected",
});

export const JOB_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL_INPUT: "partial_input",
  REJECTED: "rejected",
  UNAVAILABLE_HEAVY: "unavailable_heavy",
  UNAVAILABLE_NATIVE: "unavailable_native",
  HELD: "held",
  META: "meta",
  UNKNOWN: "unknown",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  UNKNOWN_JOB: "unknown_job",
  MISSING_HEAVY: "missing_heavy",
  MISSING_NATIVE: "missing_native",
  MISSING_FIXTURE: "missing_fixture",
  FORBIDDEN_CLAIM: "forbidden_claim",
  HEAVY_INVOKE_FAILED: "heavy_invoke_failed",
  NATIVE_INVOKE_FAILED: "native_invoke_failed",
});

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
  "revenue",
  "revenueProjection",
  "earnedUsd",
  "earnedUsdc",
  "buyerCount",
  "marketDemand",
  "siteHealthScore",
  "healthScore",
  "cveScore",
  "cveScores",
  "vulnerabilityScore",
  "securityCertification",
  "securityCert",
  "securityScore",
  "legalAdvice",
  "legalOpinion",
  "legalCertification",
  "complianceScore",
  "reputation",
  "reputationScore",
  "escrow",
  "escrowBalance",
  "custody",
  "payToBroadcast",
  "claimAuthority",
]);

/** Kit-included job ids (Heavy 01..04 + native 05..07 + kit meta 08). */
export const BUILTIN_JOB_IDS = Object.freeze([
  "openapi-impact",
  "pricing-table-change",
  "csv-drift",
  "rss-atom-brief",
  "route-regression",
  "deadline-calendar",
  "dependency-footprint",
  "source-record-kit",
]);

export const HEAVY_JOB_IDS = Object.freeze([
  "openapi-impact",
  "pricing-table-change",
  "csv-drift",
  "rss-atom-brief",
]);

export const NATIVE_JOB_IDS = Object.freeze([
  "route-regression",
  "deadline-calendar",
  "dependency-footprint",
]);

/** S154 Heavy pin (BOT-S156 override). */
export const HEAVY_PIN_SHA = "65ce1867f1b4339cc708bfb72a7d9a5942785632";
export const HEAVY_PIN_REPO = "epistemedeus/samedaydesk";
export const HEAVY_PIN_BRANCH = "codex/s154-record-metadata-final-20260910";

export const DEFAULT_HEAVY_S134_ROOT =
  "/workspace/pilot/worktrees/samedaydesk-s154-record-65ce1867/experiments/s134-record-jobs";

export const DEFAULT_NATIVE_ROOTS = Object.freeze({
  "route-regression":
    "/workspace/pilot/worktrees/r2-record-jobs-05-20260910/experiments/scale-r2-20260910/record_jobs/05",
  "deadline-calendar":
    "/workspace/pilot/worktrees/r2-record-jobs-06-20260910/experiments/scale-r2-20260910/record_jobs/06",
  "dependency-footprint":
    "/workspace/pilot/worktrees/r2-record-jobs-07-20260910/experiments/scale-r2-20260910/record_jobs/07",
  "source-record-kit-ref-08":
    "/workspace/pilot/worktrees/r2-record-jobs-08-20260910/experiments/scale-r2-20260910/record_jobs/08",
});

export const HEAVY_CLI_REL = Object.freeze({
  "openapi-impact": "modules/openapi-impact/cli.mjs",
  "pricing-table-change": "modules/pricing-table-change/cli.mjs",
  "csv-drift": "modules/csv-drift/cli.mjs",
  "rss-atom-brief": "modules/rss-atom-brief/cli.mjs",
});

export const NATIVE_BUILD_EXPORT = Object.freeze({
  "route-regression": "buildRouteRegressionReport",
  "deadline-calendar": "buildDeadlineCalendar",
  "dependency-footprint": "buildDependencyFootprintOverlap",
});

export const NATIVE_CLI_CMD = Object.freeze({
  "route-regression": "report",
  "deadline-calendar": "calendar",
  "dependency-footprint": "report",
});

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const DRY_RUN_NOTE =
  "Offline/fixtures only: invoke Heavy S154 CLIs + native 05..07 when present; never invent OpenAPI/pricing/CSV/feed/native results.";

export const CSV_WRAPPER_NOTE =
  "CSV S154 deltas preserved via kit wrappers only (no Heavy tree edits): null-prototype cells; meta separate; __status/__extraFields/__proto__ compared; empty vs missing; columns:false retains first row; relax:false rejects uneven width.";

export const HEAVY_ENV_KEY = "HEAVY_S134_ROOT";
