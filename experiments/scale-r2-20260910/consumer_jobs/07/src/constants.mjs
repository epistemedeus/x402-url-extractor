/**
 * R2-CONSUMER-JOBS-07 — Evidence-based procurement brief constants.
 *
 * Shared vocabulary documented for later alignment with R2-CAPABILITIES-04
 * (Cost-aware dry-run comparison). Cap04 is not finished yet; this package
 * defines the dry-run price / free-baseline states Cap04 can reuse.
 *
 * reuseFrom: R2-CAPABILITIES-04 (semantic target; fixtures precede Cap04 artifact)
 * Aligns freeAlternative states with payment-rail purchase-intent FREE_ALTERNATIVE_STATES.
 * Aligns price-source / forbidden-field spirit with capability-market PRICE_SOURCE / FORBIDDEN_FIELDS.
 *
 * No ranking, reputation, invest advice, revenue projections, escrow, or custody.
 */

export const REUSE_FROM = "R2-CAPABILITIES-04";

export const SCHEMA = "x402.r2.consumer.procurement_brief.v1";
export const INPUT_SCHEMA = "x402.r2.consumer.procurement_input.v1";

export const BRIEF_STATUS = Object.freeze({
  READY: "ready",
  PARTIAL_INPUT: "partial_input",
  REJECTED: "rejected",
});

/** Dry-run price states (Cap04-aligned vocabulary). */
export const PRICE_STATE = Object.freeze({
  QUOTED: "quoted",
  MISSING_PRICE: "missing_price",
  /** Cost outside the quoted amount / not included in the quote. */
  EXTERNAL_COST: "external_cost",
  /** Stale observation or fixture-labelled / not-a-live-offer source. */
  STALE_OR_UNTRUSTED_SOURCE: "stale_or_untrusted_source",
});

/**
 * Caller-supplied price source labels for dry-run fixtures.
 * FIXTURE_DEMO and STALE_OBSERVED map to PRICE_STATE.STALE_OR_UNTRUSTED_SOURCE.
 */
export const PRICE_SOURCE = Object.freeze({
  CALLER_SUPPLIED: "caller.supplied.quote",
  FIXTURE_DEMO: "fixture.demo.not-a-live-offer",
  STALE_OBSERVED: "observed.stale",
  SAMEDAYDESK_BATCH_QUOTE: "samedaydesk.extract-batch.quote",
});

/**
 * Free alternative states — keep `unavailable` distinct from empty/no-users.
 * Mirrors payment-rail buyer purchase-intent FREE_ALTERNATIVE_STATES.
 */
export const FREE_ALTERNATIVE_STATE = Object.freeze({
  EQUIVALENT: "equivalent",
  NOT_EQUIVALENT: "not_equivalent",
  UNAVAILABLE: "unavailable",
});

export const NEED_COVERAGE = Object.freeze({
  MATCHED: "matched",
  MISSING: "missing",
  UNMET: "unmet",
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  MISSING_REQUIREMENT: "missing_requirement",
  FORBIDDEN_CLAIM: "forbidden_claim",
});

/**
 * Reject inputs that invent ranking / reputation / invest / revenue / escrow / custody.
 * Includes Cap04-adjacent and Exchange01-adjacent forbidden claim names.
 */
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

export const MUTATION_BOUNDARY =
  "Isolated feature-branch source/tests only. Root owns merge, publication, and paid actions.";

export const DRY_RUN_NOTE =
  "Dry-run only: compare caller-supplied fixtures; never fetch live paid offers.";
