/**
 * R2-CONSUMER-JOBS-08 — Thin customer result package constants.
 *
 * Assembles independent CLI recipes into a customer-facing result package.
 * Ready today: procurement-brief (R2-CONSUMER-JOBS-07).
 * Heavy slots 01–06: explicit unavailable_pending_heavy (not empty/no-users).
 *
 * No paid calls, no investment recommendations, no invented Heavy artifacts.
 */

export const SCHEMA = "x402.r2.consumer.customer_result_package.v1";
export const INPUT_SCHEMA = "x402.r2.consumer.customer_result_request.v1";
export const MANIFEST_SCHEMA = "x402.r2.consumer.recipe_manifest.v1";

export const PACKAGE_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL: "partial",
  REJECTED: "rejected",
});

/** Recipe readiness — keep unavailable_pending_heavy distinct from empty/no-users. */
export const RECIPE_STATUS = Object.freeze({
  READY: "ready",
  UNAVAILABLE_PENDING_HEAVY: "unavailable_pending_heavy",
  UNKNOWN: "unknown",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  UNKNOWN_RECIPE: "unknown_recipe",
  RECIPE_UNAVAILABLE: "recipe_unavailable",
  MISSING_DEPENDENCY: "missing_dependency",
  FORBIDDEN_CLAIM: "forbidden_claim",
});

export const FORBIDDEN_FIELDS = Object.freeze([
  "rankingScore",
  "rankScore",
  "universalRank",
  "reputation",
  "reputationScore",
  "rating",
  "reviews",
  "investmentRecommendation",
  "buySellAdvice",
  "investAdvice",
  "revenue",
  "revenueProjection",
  "earnedUsd",
  "earnedUsdc",
  "buyerCount",
  "marketDemand",
  "escrow",
  "escrowBalance",
  "custody",
  "payToBroadcast",
  "claimAuthority",
]);

/** Built-in recipe ids shipped with this thin package. */
export const BUILTIN_RECIPE_IDS = Object.freeze([
  "procurement-brief",
  "heavy-01-evidence-capture",
  "heavy-02-evidence-normalize",
  "heavy-03-evidence-link",
  "heavy-04-evidence-score-gate",
  "heavy-05-evidence-package",
  "heavy-06-evidence-publish-prep",
]);

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const DRY_RUN_NOTE =
  "Offline/fixtures only: assemble recipe outputs; never invent Heavy 01–06 artifacts or paid results.";

export const HEAVY_PENDING_NOTE =
  "Heavy consumer jobs 01–06 are not ready on this thin branch. Slots remain status unavailable_pending_heavy until exact Heavy artifacts return.";
