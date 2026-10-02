import { ATOMIC, EFFORT_PLANES, HISTORIC_BANKED_REVENUE_SOURCE, HISTORIC_BANKED_REVENUE_USDC } from "./constants.mjs";
import { fail } from "./errors.mjs";

function atomic(value) {
  return typeof value === "string" && ATOMIC.test(value) ? value : null;
}

function point(value) {
  if (value == null) return { known: false };
  if (typeof value !== "object" || Array.isArray(value)) return { known: false };
  if (value.known === false) return { known: false, reason: value.reason || "unknown" };
  if (value.allocatable === true) fail("shared_rnd_not_allocatable");
  const single = atomic(value.atomic);
  const lower = atomic(value.lower) || single;
  const upper = atomic(value.upper) || single;
  if (!lower || !upper) return { known: false, reason: value.reason || "not_atomic" };
  if (BigInt(lower) > BigInt(upper)) return { known: false, reason: "bounds_reversed" };
  return { known: true, lower, upper, countsAsCash: value.countsAsCash === true, countsAsProfit: false };
}

function add(left, right) {
  return (BigInt(left) + BigInt(right)).toString();
}

function sub(left, right) {
  return (BigInt(left) - BigInt(right)).toString();
}

export function emptyCosts() {
  return {
    grossSettledRevenue: { known: false, reason: "not_supplied" },
    fees: { known: false, reason: "not_supplied" },
    cashMarginal: { known: false, reason: "not_supplied" },
    apiEquivalentBuildEffort: { known: false, reason: "not_supplied", countsAsCash: false },
    includedQuotaOpportunityCost: { known: false, reason: "not_supplied", countsAsCash: false },
    reviewAdaptation: { known: false, reason: "not_supplied" },
    sharedRnd: { known: false, reason: "not_supplied", allocatable: false },
    measuredLaterSavedWork: { known: false, reason: "not_supplied", countsAsCash: false },
  };
}

export function projectCosts(input) {
  if (input == null) return emptyCosts();
  if (typeof input !== "object" || Array.isArray(input)) fail("invalid_bundle");
  if (input.bookHistoricalAsMargin === true || input.historicalCountsAsMargin === true) fail("historical_not_margin");
  if (input.historicalCountsAsFutureCashAllocation === true) fail("historical_not_margin");
  if (input.sharedRnd?.allocatable === true || input.allocateSharedRnd === true) fail("shared_rnd_not_allocatable");
  const gross = point(input.grossSettledRevenueAtomic || input.grossSettledRevenue);
  const fees = point(input.feesAtomic || input.fees);
  const cash = point(input.cashMarginalAtomic || input.cashMarginal);
  const review = point(input.reviewAdaptationAtomic || input.reviewAdaptation);
  const quota = point(input.includedQuotaOpportunityCostAtomic || input.includedQuotaOpportunityCost);
  const shared = point(input.sharedRndAtomic || input.sharedRnd);
  const effort = input.apiEquivalentBuildEffort;
  const saved = input.measuredLaterSavedWork;
  const api = effort && typeof effort === "object" && Number.isInteger(effort.probes) && effort.probes >= 0
    ? { known: true, probes: effort.probes, tokens: effort.tokens ?? "unknown", countsAsCash: false, countsAsProfit: false }
    : { known: false, reason: "not_supplied", countsAsCash: false };
  const later = saved && typeof saved === "object" && Number.isInteger(saved.saved) && saved.saved >= 0
    ? { known: true, unit: typeof saved.unit === "string" ? saved.unit : "unknown", saved: saved.saved, countsAsCash: false }
    : { known: false, reason: "not_supplied", countsAsCash: false };
  return {
    grossSettledRevenue: gross,
    fees,
    cashMarginal: { ...cash, countsAsCash: cash.known ? true : false },
    apiEquivalentBuildEffort: api,
    includedQuotaOpportunityCost: { ...quota, countsAsCash: false },
    reviewAdaptation: review,
    sharedRnd: { ...shared, allocatable: false, countsAsCash: false },
    measuredLaterSavedWork: later,
  };
}

function wider(left, right) {
  if (!left?.known) return right?.known ? right : { known: false, reason: "unknown" };
  if (!right?.known) return left;
  const lower = BigInt(left.lower) < BigInt(right.lower) ? left.lower : right.lower;
  const upper = BigInt(left.upper) > BigInt(right.upper) ? left.upper : right.upper;
  return { known: true, lower, upper, countsAsCash: false };
}

export function mergeCosts(parts) {
  const base = emptyCosts();
  let probes = null;
  let saved = null;
  let gross = null;
  let fees = null;
  let cash = null;
  let review = null;
  let quota = null;
  let shared = null;
  for (const part of parts) {
    if (!part) continue;
    if (part.apiEquivalentBuildEffort?.known) {
      probes = (probes || 0) + part.apiEquivalentBuildEffort.probes;
    } else if (part.apiEquivalentBuildEffort && part.apiEquivalentBuildEffort.reason !== "not_supplied") {
      probes = null;
    }
    if (part.measuredLaterSavedWork?.known) {
      if (saved && saved.unit !== part.measuredLaterSavedWork.unit) saved = { conflict: true };
      else saved = { unit: part.measuredLaterSavedWork.unit, saved: (saved?.saved || 0) + part.measuredLaterSavedWork.saved };
    }
    gross = gross ? conflictOrEqual(gross, part.grossSettledRevenue) : part.grossSettledRevenue;
    fees = fees ? wider(fees, part.fees) : part.fees;
    cash = cash ? wider(cash, part.cashMarginal) : part.cashMarginal;
    review = review ? wider(review, part.reviewAdaptation) : part.reviewAdaptation;
    quota = quota ? wider(quota, part.includedQuotaOpportunityCost) : part.includedQuotaOpportunityCost;
    shared = shared ? conflictOrEqual(shared, part.sharedRnd) : part.sharedRnd;
  }
  if (probes != null) {
    base.apiEquivalentBuildEffort = { known: true, probes, tokens: "unknown", countsAsCash: false, countsAsProfit: false };
  }
  if (saved?.conflict) base.measuredLaterSavedWork = { known: false, reason: "unit_conflict", countsAsCash: false };
  else if (saved) base.measuredLaterSavedWork = { known: true, ...saved, countsAsCash: false };
  if (gross?.known) base.grossSettledRevenue = gross;
  else if (gross?.reason) base.grossSettledRevenue = gross;
  if (fees?.known) base.fees = fees;
  if (cash?.known) base.cashMarginal = { ...cash, countsAsCash: true };
  if (review?.known) base.reviewAdaptation = review;
  if (quota?.known) base.includedQuotaOpportunityCost = { ...quota, countsAsCash: false };
  if (shared?.known) base.sharedRnd = { ...shared, allocatable: false, countsAsCash: false };
  else if (shared?.reason) base.sharedRnd = { ...shared, allocatable: false, countsAsCash: false };
  return base;
}

function conflictOrEqual(left, right) {
  if (!right) return left;
  if (!left?.known || !right.known) return left?.known ? left : right;
  if (left.lower !== right.lower || left.upper !== right.upper) {
    return { known: false, reason: "conflict" };
  }
  return left;
}

export function observeGross(journeys) {
  let known = 0n;
  let knownCount = 0;
  let missing = 0;
  let verified = 0;
  for (const journey of journeys) {
    if (journey.settlementStatus !== "verified" || journey.settlementTrusted !== true) continue;
    verified += 1;
    if (journey.grossSettledAtomic && ATOMIC.test(journey.grossSettledAtomic)) {
      known += BigInt(journey.grossSettledAtomic);
      knownCount += 1;
    } else missing += 1;
  }
  if (verified === 0) return { known: false, reason: "no_trusted_settlement", verified, observedKnownCount: 0 };
  if (missing > 0) {
    return {
      known: false,
      reason: "incomplete_amounts",
      verified,
      observedKnownCount: knownCount,
      observedKnownAtomic: known.toString(),
      verifiedMissingAmount: missing,
    };
  }
  return { known: true, lower: known.toString(), upper: known.toString(), countsAsCash: false, verified };
}

export function settleEconomics({ supplied, observedGross }) {
  const costs = mergeCosts([projectCosts(supplied), { grossSettledRevenue: observedGross }]);
  if (supplied?.grossSettledRevenueAtomic && observedGross?.known) {
    const suppliedPoint = point(supplied.grossSettledRevenueAtomic);
    if (suppliedPoint.known && (suppliedPoint.lower !== observedGross.lower || suppliedPoint.upper !== observedGross.upper)) {
      costs.grossSettledRevenue = { known: false, reason: "gross_conflict" };
    }
  }
  const cashReady = costs.grossSettledRevenue.known && costs.fees.known && costs.cashMarginal.known;
  let breakeven = { calculable: false, reason: "missing_cash_inputs", lowerNetAtomic: null, upperNetAtomic: null };
  if (cashReady) {
    const lowerNet = sub(sub(costs.grossSettledRevenue.lower, costs.fees.upper), costs.cashMarginal.upper);
    const upperNet = sub(sub(costs.grossSettledRevenue.upper, costs.fees.lower), costs.cashMarginal.lower);
    let position = "between";
    if (BigInt(lowerNet) > 0n) position = "above";
    else if (BigInt(upperNet) < 0n) position = "below";
    breakeven = {
      calculable: true,
      reason: null,
      lowerNetAtomic: lowerNet,
      upperNetAtomic: upperNet,
      position,
      includedQuotaCountedAsCash: false,
      sharedRndCountedAsCash: false,
      historicalCounted: false,
    };
  }
  return {
    planes: costs,
    effortPlanes: EFFORT_PLANES.map((plane) => ({
      id: plane.id,
      field: plane.field,
      ledgerView: plane.ledgerView,
      sumsIntoCash: plane.sumsIntoCash === true && costs[plane.field]?.countsAsCash === true,
      known: costs[plane.field]?.known === true,
    })),
    breakeven,
    recognizedRevenueAtomic: "0",
    historicalBankedRevenueUsdc: HISTORIC_BANKED_REVENUE_USDC,
    historicalBankedRevenueSource: HISTORIC_BANKED_REVENUE_SOURCE,
    historicalCountsAsMargin: false,
    historicalCountsAsFutureCashAllocation: false,
    historicalCountedInBreakeven: false,
    profit: null,
    summed: false,
  };
}
