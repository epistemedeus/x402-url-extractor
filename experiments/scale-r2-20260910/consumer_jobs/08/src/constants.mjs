/**
 * R2-CONSUMER-JOBS-08 — Thin customer result package constants (S152 compose).
 *
 * Ready: procurement-brief (07) + Heavy S137 artifacts 01–06 via CLI spawn.
 * No paid calls, no investment recommendations, no invented Heavy artifacts.
 */

export const SCHEMA = "x402.r2.consumer.customer_result_package.v1";
export const INPUT_SCHEMA = "x402.r2.consumer.customer_result_request.v1";
export const MANIFEST_SCHEMA = "x402.r2.consumer.recipe_manifest.v1";
export const HEAVY_PACKET_SCHEMA = "s137.consumer-evidence.packet.v1";

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
  FAILED: "failed",
  REJECTED: "rejected",
  CONFLICT: "conflict",
  PARTIAL: "partial",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  UNKNOWN_RECIPE: "unknown_recipe",
  RECIPE_UNAVAILABLE: "recipe_unavailable",
  MISSING_DEPENDENCY: "missing_dependency",
  FORBIDDEN_CLAIM: "forbidden_claim",
  UNSAFE_PATH: "unsafe_path",
  MISSING_CLOCK: "missing_clock",
  MISSING_IN: "missing_in",
  HEAVY_REFUSED: "heavy_refused",
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

/** Built-in recipe ids: 07 procurement-brief + Heavy 01–06 artifact ids. */
export const BUILTIN_RECIPE_IDS = Object.freeze([
  "procurement-brief",
  "migration-checklist",
  "release-brief",
  "table-reconcile",
  "link-index",
  "replay-pack",
  "freshness-receipt",
]);

export const HEAVY_RECIPE_IDS = Object.freeze([
  "migration-checklist",
  "release-brief",
  "table-reconcile",
  "link-index",
  "replay-pack",
  "freshness-receipt",
]);

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const DRY_RUN_NOTE =
  "Offline/fixtures only: assemble recipe outputs from real CLI spawns; never invent Heavy packets or paid results.";

export const HEAVY_PENDING_NOTE =
  "Heavy consumer jobs 01–06 are wired via S137 CLI when recipes are ready. Unavailable slots remain unavailable_pending_heavy until Exact Heavy artifacts return.";

export const DEFAULT_OPERATOR_CLOCK = "2026-09-10T18:00:00.000Z";
