import { METRIC_SCHEMA } from "./constants.mjs";

export function measure({ intake, classification, probes, retest, contribution, later, paid }) {
  return {
    schema: METRIC_SCHEMA,
    attempt: Array.isArray(probes) ? probes.length : 0,
    usefulMismatch: classification?.outcome === "mismatch" ? 1 : 0,
    repairRetest: retest ? 1 : 0,
    requesterAmendmentEffort: {
      probes: Array.isArray(probes) ? probes.length : 0,
      bodyBytes: intake?.maxEffort?.bodyBytes ?? 0,
      deadlineMs: intake?.maxEffort?.deadlineMs ?? 0,
    },
    adaptationMaintenanceCost: "unknown",
    qualifiedPaidIntent: intake?.paidIntent === true ? 1 : 0,
    actualValidDelivery: paid?.actualValidDelivery === true ? 1 : 0,
    acceptedContribution: contribution?.accepted === true ? 1 : 0,
    laterReuse: later?.reused === true ? 1 : 0,
    cashAtomic: "unknown",
    tokens: "unknown",
    includedQuotaApiEquivalentEffort: {
      probeCount: Array.isArray(probes) ? probes.length : 0,
      countsAsCash: false,
      countsAsProfit: false,
    },
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
    profit: null,
    separate: true,
  };
}
