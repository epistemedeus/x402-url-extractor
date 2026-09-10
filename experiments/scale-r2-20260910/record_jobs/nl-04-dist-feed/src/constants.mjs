/**
 * NL-RECORD-04 — Distribution repair feed constants.
 *
 * Wraps record_jobs/05 route regression into a deterministic repair
 * recommendation document for NL-DISTRIBUTION-06 / distribution/08 consumers.
 * No crawl; no SEO/traffic/ranking invention; coverage-preserving removals.
 */

export const FEED_SCHEMA = "pilot.nl.record.dist_repair_feed.v1";
export const REUSE_FROM = "NL-RECORD-04";

export const FEED_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL_INPUT: "partial_input",
  REJECTED: "rejected",
});

/** Deterministic recommendation actions. */
export const RECOMMENDATION = Object.freeze({
  RECOMMEND_DISTRIBUTION_RECHECK: "recommend_distribution_recheck",
  SURFACE_BROKEN_OR_REMOVED_ROUTE: "surface_broken_or_removed_route",
  CANNOT_PROVE_GLOBAL_REMOVAL: "cannot_prove_global_removal",
  RECHECK_WITH_COMPLETE_CAPTURE: "recheck_with_complete_capture",
  UPDATE_LISTED_ROUTE_OR_REDIRECT_TARGET: "update_listed_route_or_redirect_target",
  DIAGNOSE_ACCESS_OR_LISTING_PATH: "diagnose_access_or_listing_path",
  CONFIRM_RESTORED_ROUTE_IN_LISTING: "confirm_restored_route_in_listing",
  CONSIDER_LISTING_NEW_ROUTE: "consider_listing_new_route",
  RECORD_STATUS_CHANGE_FOR_LISTING: "record_status_change_for_listing",
  NO_ACTION_UNCHANGED: "no_action_unchanged",
  SKIP_REJECTED_INPUT: "skip_rejected_input",
});

export const CONFIDENCE = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "none",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  MISSING_REQUIREMENT: "missing_requirement",
  FORBIDDEN_CLAIM: "forbidden_claim",
});

/** Union of record_jobs/05 + distribution/08 intent/revenue forbids. */
export const FORBIDDEN_FIELDS = Object.freeze([
  // record_jobs/05
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
  // distribution/08 intent
  "buyerIntent",
  "purchaseIntent",
  "intentToBuy",
  "buyerIntentScore",
  "purchaseIntentScore",
  "clickImpliesIntent",
  "activationImpliesIntent",
  "conversionIntent",
  "qualifiedLead",
  "hotLead",
  "clickIsConversion",
  "activationIsConversion",
  // distribution/08 claim/revenue
  "buyerCount",
  "earnedUsd",
  "earnedUsdc",
  "inventedRevenue",
  "forecastRevenue",
  "projectedSales",
  "userCountInvented",
  "fakeEarnings",
  "syntheticRevenue",
  "escrowBalance",
  "claimAuthority",
  "liveClicks",
  "realTraffic",
  "conversionCount",
  "conversionRate",
  "attributedRevenue",
]);

export const USABLE_BY = Object.freeze([
  "NL-DISTRIBUTION-06",
  "distribution/08",
]);

export const PINS = Object.freeze({
  merchantRecord05: "a7e2cd7a2223e2aa7e7e09eebf3695aba4731205",
  samedaydeskDist08: "ea000772cdbd6d5df7174369dcef9aa2270e5723",
  recordJobs05Path: "experiments/scale-r2-20260910/record_jobs/05",
  distribution08Path: "experiments/scale-r2-20260910/distribution/08",
  routeRegressionSchema: "x402.r2.record.route_regression_report.v1",
  routeRegressionInputSchema: "x402.r2.record.route_regression_input.v1",
  diagnosisSchemaCite: "pilot.r2.distribution.conversion_diagnosis.v1",
});

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const SCOPE_NOTE =
  "Feed maps only the supplied baseline+current route snapshot pair into repair recommendations. Absence under incomplete current capture cannot prove global removal. Not a crawl, SEO, traffic, or ranking claim.";

export const COVERAGE_NOTE =
  "coveragePreserved: when current capture is incomplete/partial, removed deltas become cannot_prove_global_removal / recheck_with_complete_capture — never a global-removal claim.";

export const DRY_RUN_NOTE =
  "Fixture/snapshot feed only: never crawl live sites; never invent crawler/traffic/ranking results.";
