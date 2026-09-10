/**
 * R2-RECORD-JOBS-08 — Recurring job bundle constants.
 *
 * Packages distinct useful record jobs (native-owned 05..07) with real public /
 * synthetic input pairs and reproducible outputs over existing customer tooling.
 * Heavy 01..04 appear as owned_by_heavy / not_bundled_here catalog stubs only —
 * never reimplemented here.
 *
 * Offline / fixtures only. No live paid calls. No inventing buyers/revenue,
 * SEO/traffic/invest advice, security certification, or legal advice.
 */

export const SCHEMA = "x402.r2.record.recurring_job_bundle.v1";
export const INPUT_SCHEMA = "x402.r2.record.bundle_request.v1";
export const MANIFEST_SCHEMA = "x402.r2.record.job_manifest.v1";

export const BUNDLE_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL: "partial",
  REJECTED: "rejected",
});

/** Per-job slot status inside a bundle run. */
export const JOB_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL_INPUT: "partial_input",
  REJECTED: "rejected",
  UNAVAILABLE_SIBLING: "unavailable_sibling",
  OWNED_BY_HEAVY: "owned_by_heavy",
  UNKNOWN: "unknown",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  UNKNOWN_JOB: "unknown_job",
  JOB_UNAVAILABLE: "job_unavailable",
  MISSING_SIBLING: "missing_sibling",
  MISSING_FIXTURE: "missing_fixture",
  FORBIDDEN_CLAIM: "forbidden_claim",
});

/**
 * Reject bundle requests that invent marketing / security / legal / invest claims.
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

/** Built-in job ids shipped with this recurring bundle. */
export const BUILTIN_JOB_IDS = Object.freeze([
  "route-regression",
  "deadline-calendar",
  "dependency-footprint",
  "heavy-01-not-bundled",
  "heavy-02-not-bundled",
  "heavy-03-not-bundled",
  "heavy-04-not-bundled",
]);

/** Native Pilot Source/Record slots that this package actually runs. */
export const NATIVE_JOB_IDS = Object.freeze([
  "route-regression",
  "deadline-calendar",
  "dependency-footprint",
]);

/**
 * Default absolute sibling worktree roots on this Pilot VM.
 * BOUNDARY: demos prefer these when present; otherwise fall back to embedded
 * fixtures and mark jobStatus unavailable_sibling (never invent outputs).
 */
export const DEFAULT_SIBLING_ROOTS = Object.freeze({
  "route-regression":
    "/workspace/pilot/worktrees/r2-record-jobs-05-20260910/experiments/scale-r2-20260910/record_jobs/05",
  "deadline-calendar":
    "/workspace/pilot/worktrees/r2-record-jobs-06-20260910/experiments/scale-r2-20260910/record_jobs/06",
  "dependency-footprint":
    "/workspace/pilot/worktrees/r2-record-jobs-07-20260910/experiments/scale-r2-20260910/record_jobs/07",
});

/** Relative same-checkout fallbacks (when 05/06/07 live beside 08). */
export const RELATIVE_SIBLING_DIRS = Object.freeze({
  "route-regression": "../05",
  "deadline-calendar": "../06",
  "dependency-footprint": "../07",
});

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const DRY_RUN_NOTE =
  "Offline/fixtures only: run native 05..07 record jobs when sibling packages are present; never invent Heavy 01..04 or paid results.";

export const HEAVY_STUB_NOTE =
  "Record jobs 01..04 are owned_by_heavy / not_bundled_here. This package does not copy or rebuild Heavy artifacts.";

export const SIBLING_BOUNDARY_NOTE =
  "BOUNDARY: Prefer absolute Pilot VM sibling worktrees when present; else relative ../05|06|07; else embedded fixtures with jobStatus unavailable_sibling (no invented outputs).";
