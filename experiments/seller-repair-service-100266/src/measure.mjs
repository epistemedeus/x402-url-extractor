import { METRIC_SCHEMA } from "./constants.mjs";

function usefulDeliveryOf(classification) {
  if (!classification) return "unknown";
  if (classification.outcome === "unknown" || classification.outcome === "unsupported") return "unknown";
  return classification.useful === true ? "true" : "false";
}

export function measure({ intake, classification, probes, retest, contribution, later, paid, budget = null }) {
  const probeCount = Array.isArray(probes) ? probes.length : 0;
  return {
    schema: METRIC_SCHEMA,
    attempt: probeCount,
    usefulDelivery: usefulDeliveryOf(classification),
    usefulMismatch: classification?.outcome === "mismatch" ? 1 : 0,
    observedCaseRepair: retest?.useful === true ? 1 : 0,
    repairRetest: retest ? 1 : 0,
    laterApplicableReuse: later?.laterCaller === true && later?.reused === true ? 1 : 0,
    requesterAmendmentEffort: {
      probes: intake?.maxEffort?.probes ?? 0,
      bodyBytes: intake?.maxEffort?.bodyBytes ?? 0,
      deadlineMs: intake?.maxEffort?.deadlineMs ?? 0,
      totalBodyBytes: intake?.maxEffort?.totalBodyBytes ?? 0,
      totalResponseMs: intake?.maxEffort?.totalResponseMs ?? 0,
      redirects: intake?.maxEffort?.redirects ?? 0,
    },
    callerEffort: {
      probes: budget?.probesUsed ?? probeCount,
      bodyBytes: budget?.bodyBytesSeen ?? 0,
      redirects: budget?.redirectsSeen ?? 0,
      redirectsFollowed: 0,
    },
    contributorEffort: {
      acceptedDerivatives: contribution?.accepted === true ? 1 : 0,
      countsAsCash: false,
    },
    actualSourceCoverage: "unknown",
    adaptationMaintenanceCost: "unknown",
    totalEngineeringCost: "unknown",
    qualifiedPaidIntent: intake?.paidIntent === true ? 1 : 0,
    actualValidDelivery: paid?.actualValidDelivery === true ? 1 : 0,
    acceptedContribution: contribution?.accepted === true ? 1 : 0,
    laterReuse: later?.reused === true ? 1 : 0,
    cashAtomic: "unknown",
    tokens: "unknown",
    includedQuotaApiEquivalentEffort: {
      probeCount,
      countsAsCash: false,
      countsAsProfit: false,
    },
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
    savingsAtomic: "unknown",
    paidAuthority: "none",
    adoption: "unknown",
    revenueFromFixtureOrDownload: "0",
    profit: null,
    separate: true,
  };
}
