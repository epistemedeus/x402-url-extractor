import { containsRestrictedKey } from "../../../tools/ops/three-site-settlement-join/measure/src/restricted.mjs";
import {
  CLOCK_WINDOW_FIX,
  CLOCK_WINDOW_FIX_APPLIED,
  CLOCK_WINDOW_FIX_COMMIT_ANCESTOR_OF_MERCHANT161,
  CLOCK_WINDOW_FIX_CONTENT_ON_MERCHANT161,
  FORBIDDEN_OPERATION,
  PINS,
  PRODUCTION_FRESHNESS_MAX_AGE_MS,
} from "./constants.mjs";
import { fail } from "./errors.mjs";

const BASELINE_SCHEMA = "samedaydesk.production-funnel-baseline.v1";

function hasPaidSuccessKey(baseline) {
  const byResult = baseline?.stream?.byResult;
  return Boolean(byResult) && Object.prototype.hasOwnProperty.call(byResult, "paid_success");
}

export function publicSeam(baseline) {
  if (!baseline) {
    return {
      status: "unresolved",
      missingLink: "per_attempt_public_call_identity",
      coveredExternalEvents: null,
      coveredExternalEventsAreCustomers: false,
      coveredExternalEventsAreAttemptDenominator: false,
      paidSuccess: {
        disposition: "unresolved",
        observed: null,
        reason: "covered_baseline_not_attached",
      },
      populationConversionRate: null,
      enrollment: "unresolved",
      serverDelta: "applied",
      releasedMerchantHead: PINS.releasedMerchantHead,
      historicalReleasedMerchantHead: PINS.historicalReleasedMerchantHead,
      publicAcquisitionArtifact: PINS.publicAcquisitionArtifact,
    };
  }
  if (baseline.schema !== BASELINE_SCHEMA) fail("public_aggregate_rejected");
  if (containsRestrictedKey(baseline)) fail("wallet_or_header_is_not_identity");
  const streamPaid = baseline.stream?.paidSuccessEvents?.observed;
  const absent = streamPaid == null || !hasPaidSuccessKey(baseline);
  return {
    status: "unresolved",
    missingLink: baseline.missingLink?.id || "per_attempt_public_call_identity",
    coveredExternalEvents: Number.isInteger(baseline.stream?.externalEvents?.observed)
      ? baseline.stream.externalEvents.observed
      : null,
    coveredExternalEventsAreCustomers: false,
    coveredExternalEventsAreAttemptDenominator: false,
    paidSuccess: {
      disposition: "unresolved",
      observed: null,
      streamField: absent ? null : streamPaid,
      reason: absent ? "absent_from_covered_byresult_not_zero" : "stream_count_is_not_this_attempt",
    },
    rareCoveredPaidSuccessCensus: false,
    populationConversionRate: null,
    enrollment: "unresolved",
    serverDelta: "applied",
    clockWindowFix: {
      commit: CLOCK_WINDOW_FIX,
      applied: CLOCK_WINDOW_FIX_APPLIED,
      commitIsAncestorOfMerchant161: CLOCK_WINDOW_FIX_COMMIT_ANCESTOR_OF_MERCHANT161,
      contentPresentOnMerchant161: CLOCK_WINDOW_FIX_CONTENT_ON_MERCHANT161,
      productionFreshnessMaxAgeMs: PRODUCTION_FRESHNESS_MAX_AGE_MS,
    },
    releasedMerchantHead: PINS.releasedMerchantHead,
    historicalReleasedMerchantHead: PINS.historicalReleasedMerchantHead,
    publicAcquisitionArtifact: PINS.publicAcquisitionArtifact,
  };
}

export function refuseFalseJoin(baseline, proposal) {
  if (!baseline || baseline.schema !== BASELINE_SCHEMA) fail("public_aggregate_rejected");
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) fail("wrong_join");
  if (containsRestrictedKey(proposal)) fail("wallet_or_header_is_not_identity");
  const reasons = [];
  if (proposal.attemptOf != null) reasons.push("attempt_of_not_null");
  if (proposal.operationId === FORBIDDEN_OPERATION || proposal.remintOperation === FORBIDDEN_OPERATION) {
    reasons.push("operation_remint_refused");
  }
  if (proposal.census === true || proposal.conversionDenominator != null || proposal.dividePopulations === true) {
    reasons.push("population_conversion_refused");
  }
  if (proposal.paidSuccess === 0 && (baseline.stream?.paidSuccessEvents?.observed == null || !hasPaidSuccessKey(baseline))) {
    reasons.push("paid_success_absent_is_not_zero");
  }
  if (proposal.rarePaidSuccessIsCensus === true || (proposal.census === true && baseline.rareCoveredSlice?.paidSuccessEvents?.census !== true)) {
    reasons.push("rare_zero_is_not_census");
  }
  if (proposal.payingCustomers != null) reasons.push("settlement_is_not_customer");
  if (proposal.uniqueAgentsFromActors === true || proposal.uniqueAgentsFromHeaders === true) {
    reasons.push("actor_or_header_is_not_agent");
  }
  if (proposal.externalUsefulnessClaim === true) reasons.push("external_claim_is_not_usefulness");
  if (proposal.link != null || proposal.counterfeitLink === true) reasons.push("counterfeit_link");
  if (proposal.paymentReplay === true) reasons.push("payment_replay_refused");
  if (reasons.length === 0) fail("wrong_join", "proposal did not ask for a refused join");
  return {
    decision: "reject",
    reasons: [...new Set(reasons)].sort(),
    attemptOf: null,
    inheritedUsefulness: null,
    useful: null,
    populationConversionRate: null,
    recognizedRevenueAtomic: "unknown",
    customer: null,
    mintedGrant: false,
  };
}
