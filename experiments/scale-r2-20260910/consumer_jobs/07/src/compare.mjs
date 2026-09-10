import {
  BRIEF_STATUS,
  DRY_RUN_NOTE,
  ERROR_CODES,
  FREE_ALTERNATIVE_STATE,
  MUTATION_BOUNDARY,
  NEED_COVERAGE,
  PRICE_SOURCE,
  PRICE_STATE,
  REUSE_FROM,
  SCHEMA,
} from "./constants.mjs";
import { briefError, validateProcurementInput } from "./validate.mjs";

const STALE_SOURCES = new Set([
  PRICE_SOURCE.FIXTURE_DEMO,
  PRICE_SOURCE.STALE_OBSERVED,
  "fixture.demo.not-a-live-offer",
  "observed.stale",
]);

/**
 * Derive Cap04-aligned price state from a normalized contract.
 * Priority: missing_price → stale_or_untrusted_source → external_cost → quoted.
 */
export function derivePriceState(contract) {
  const pricePresent = contract.price?.present === true;
  if (!pricePresent) {
    return PRICE_STATE.MISSING_PRICE;
  }
  if (contract.stale === true || (contract.priceSource && STALE_SOURCES.has(contract.priceSource))) {
    return PRICE_STATE.STALE_OR_UNTRUSTED_SOURCE;
  }
  if (
    contract.hasExternalCostFlag === true ||
    (Array.isArray(contract.externalCosts) && contract.externalCosts.length > 0)
  ) {
    return PRICE_STATE.EXTERNAL_COST;
  }
  return PRICE_STATE.QUOTED;
}

function collectNeedKeys(taskNeeds) {
  // Prefer explicit musts; capabilityIds and outcomes also participate as needs to cover.
  const keys = [];
  const seen = new Set();
  for (const list of [taskNeeds.musts, taskNeeds.capabilityIds, taskNeeds.outcomes]) {
    for (const item of list) {
      if (!seen.has(item)) {
        seen.add(item);
        keys.push(item);
      }
    }
  }
  return keys;
}

function contractProvides(contract) {
  const set = new Set([
    ...contract.capabilityIds,
    ...contract.outcomes,
    ...contract.coveredMusts,
  ]);
  return set;
}

/**
 * Per-need coverage: matched if contract provides the need id/string;
 * unmet if contract declares related capability space but not this need;
 * missing if contract simply does not cover it.
 */
function buildNeedCoverage(needKeys, contract) {
  const provided = contractProvides(contract);
  const matched = [];
  const missing = [];
  const unmet = [];

  for (const need of needKeys) {
    if (provided.has(need)) {
      matched.push(need);
    } else if (provided.size > 0) {
      // Contract offers some capabilities but not this need → unmet for this contract.
      unmet.push(need);
    } else {
      missing.push(need);
    }
  }

  return {
    matched,
    missing,
    unmet,
    coverageStatus:
      matched.length === needKeys.length
        ? NEED_COVERAGE.MATCHED
        : matched.length === 0
          ? NEED_COVERAGE.MISSING
          : NEED_COVERAGE.UNMET,
  };
}

function resolveFreeBaseline(contract) {
  if (contract.freeBaseline) {
    return {
      freeAlternativeState: contract.freeBaseline.freeAlternativeState,
      freeAlternativeBasisId: contract.freeBaseline.freeAlternativeBasisId,
    };
  }
  // Explicit unavailable when no free baseline was supplied — distinct from empty/no-users.
  // Callers should prefer supplying freeBaseline with state unavailable + basisId.
  return {
    freeAlternativeState: FREE_ALTERNATIVE_STATE.UNAVAILABLE,
    freeAlternativeBasisId: "unspecified_free_baseline",
  };
}

function buildComparison(contract, needKeys) {
  const priceState = derivePriceState(contract);
  const needCoverage = buildNeedCoverage(needKeys, contract);
  const freeBaseline = resolveFreeBaseline(contract);

  const price =
    contract.price?.present === true
      ? {
          amountAtomic: contract.price.amountAtomic,
          currency: contract.price.currency,
          source: contract.priceSource ?? PRICE_SOURCE.CALLER_SUPPLIED,
        }
      : null;

  return {
    contractId: contract.contractId,
    title: contract.title,
    needCoverage,
    priceState,
    price,
    externalCosts: contract.externalCosts,
    freeBaseline,
    evidenceRefs: [...contract.evidenceRefs],
  };
}

function buildSummary(comparisons, needKeys) {
  const priceStateCounts = {
    [PRICE_STATE.QUOTED]: 0,
    [PRICE_STATE.MISSING_PRICE]: 0,
    [PRICE_STATE.EXTERNAL_COST]: 0,
    [PRICE_STATE.STALE_OR_UNTRUSTED_SOURCE]: 0,
  };
  const freeStateCounts = {
    [FREE_ALTERNATIVE_STATE.EQUIVALENT]: 0,
    [FREE_ALTERNATIVE_STATE.NOT_EQUIVALENT]: 0,
    [FREE_ALTERNATIVE_STATE.UNAVAILABLE]: 0,
  };

  let contractsFullyCoveringNeeds = 0;
  for (const c of comparisons) {
    priceStateCounts[c.priceState] = (priceStateCounts[c.priceState] || 0) + 1;
    const fs = c.freeBaseline.freeAlternativeState;
    freeStateCounts[fs] = (freeStateCounts[fs] || 0) + 1;
    if (c.needCoverage.matched.length === needKeys.length && needKeys.length > 0) {
      contractsFullyCoveringNeeds += 1;
    }
  }

  // Factual only — no investmentRecommendation / ranking / revenue fields.
  return {
    needCount: needKeys.length,
    contractCount: comparisons.length,
    contractsFullyCoveringNeeds,
    priceStateCounts,
    freeAlternativeStateCounts: freeStateCounts,
    note: "Factual counts only. No investment recommendation, ranking, or revenue projection.",
  };
}

/**
 * Build evidence-based procurement brief from caller-supplied fixtures.
 * Dry-run only — never fetches live paid offers.
 */
export function buildProcurementBrief(rawInput, { clock = () => Date.now() } = {}) {
  let input;
  try {
    input = validateProcurementInput(rawInput);
  } catch (err) {
    if (err && err.code) {
      return {
        schema: SCHEMA,
        generatedAt: new Date(clock()).toISOString(),
        status: BRIEF_STATUS.REJECTED,
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
        reuseFrom: REUSE_FROM,
        mutationBoundary: MUTATION_BOUNDARY,
        dryRun: DRY_RUN_NOTE,
        // Explicitly omit investmentRecommendation
      };
    }
    throw err;
  }

  const needKeys = collectNeedKeys(input.taskNeeds);
  const comparisons = input.serviceContracts.map((c) => buildComparison(c, needKeys));
  const summary = buildSummary(comparisons, needKeys);

  const hasMissingPrice = comparisons.some((c) => c.priceState === PRICE_STATE.MISSING_PRICE);
  const hasAnyQuoteLike = comparisons.some(
    (c) =>
      c.priceState === PRICE_STATE.QUOTED ||
      c.priceState === PRICE_STATE.EXTERNAL_COST ||
      c.priceState === PRICE_STATE.STALE_OR_UNTRUSTED_SOURCE,
  );

  let status = BRIEF_STATUS.READY;
  const partialReasons = [];
  if (hasMissingPrice) {
    status = BRIEF_STATUS.PARTIAL_INPUT;
    partialReasons.push("one_or_more_contracts_missing_price");
  }
  if (!hasAnyQuoteLike && hasMissingPrice) {
    status = BRIEF_STATUS.PARTIAL_INPUT;
    partialReasons.push("no_usable_price_states");
  }
  if (needKeys.length === 0) {
    status = BRIEF_STATUS.PARTIAL_INPUT;
    partialReasons.push("empty_task_needs");
  }

  const brief = {
    schema: SCHEMA,
    generatedAt: new Date(clock()).toISOString(),
    status,
    taskId: input.taskId,
    title: input.title,
    demo: input.demo === true,
    sourceLabel: input.sourceLabel,
    taskNeeds: input.taskNeeds,
    comparisons,
    summary,
    partialReasons: status === BRIEF_STATUS.PARTIAL_INPUT ? partialReasons : [],
    reuseFrom: REUSE_FROM,
    mutationBoundary: MUTATION_BOUNDARY,
    dryRun: DRY_RUN_NOTE,
    consumerInstructions:
      "Supply taskNeeds + serviceContracts (+ optional freeBaselines) as JSON fixtures. " +
      "Run `node src/cli.mjs brief <input.json>`. Compare need coverage and price/free states only. " +
      "Do not treat this brief as an investment recommendation.",
  };

  // Hard guarantee: never emit investmentRecommendation
  if (Object.prototype.hasOwnProperty.call(brief, "investmentRecommendation")) {
    throw briefError(ERROR_CODES.FORBIDDEN_CLAIM, "investmentRecommendation must not appear on brief");
  }

  return brief;
}

export { derivePriceState as _derivePriceStateForTests };
