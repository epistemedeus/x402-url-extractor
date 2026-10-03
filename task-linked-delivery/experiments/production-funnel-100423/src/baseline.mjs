import { createHash } from "node:crypto";
import { projectPublicAggregate } from "../../../tools/ops/three-site-settlement-join/measure/src/outcome-binding.mjs";
import { containsRestrictedKey } from "../../../tools/ops/three-site-settlement-join/measure/src/restricted.mjs";
import {
  BASELINE_SCHEMA,
  COVERED_DAYS,
  JOB_ID,
  MERCHANT157,
  PUBLIC_ROUTE,
  RARE_CONTEXT_DAYS,
  RELAY_UNION,
  REQUIRED_COHORTS,
  SETTLEMENT_COHORTS,
  SOURCE_COMMIT,
} from "./constants.mjs";
import { fail } from "./errors.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function atomic(value) {
  return typeof value === "string" && ATOMIC.test(value) ? value : null;
}

function day(value) {
  return typeof value === "string" && DAY.test(value) ? value : null;
}

function acceptAggregate(document, meta) {
  let receipt;
  try {
    receipt = projectPublicAggregate(document, {
      kind: "public_aggregate",
      path: meta.url,
      sha256: meta.sha256,
      bytes: meta.bytes,
      publicAggregateUrl: meta.url,
    });
  } catch (error) {
    fail(error.code || "public_aggregate_rejected", error.message);
  }
  if (receipt.individualJoin !== false || receipt.recognizedRevenueAtomic !== "0") {
    fail("public_aggregate_rejected", "the public aggregate is not an individual join and not revenue");
  }
  if (receipt.aggregate?.customerPlane) {
    const plane = receipt.aggregate.customerPlane;
    if (plane.attributableCustomerCount !== null
      || plane.buyerValidDeliveryCount !== null
      || plane.repeatIndependentCustomerCount !== null) {
      fail("aggregate_customer_plane", "customer counts stay null");
    }
  }
  return receipt;
}

function countMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z0-9._/-]{1,80}$/i.test(key)) return null;
    const n = count(item);
    if (n === null) return null;
    out[key] = n;
  }
  return out;
}

function observed(n, reason, extra = {}) {
  return {
    observed: n,
    census: false,
    customerDenominator: null,
    reason,
    ...extra,
  };
}

function ledgerCohorts(byClass) {
  const rows = byClass && typeof byClass === "object" && !Array.isArray(byClass) ? byClass : {};
  const cohorts = {};
  for (const cohort of REQUIRED_COHORTS) {
    cohorts[cohort] = {
      sourceClass: null,
      ledgerSettlements: null,
      ledgerAmountAtomic: null,
      coveredWindowSettlements: null,
      reason: "class_absent_not_a_zero_census",
    };
  }
  const unmapped = [];
  for (const [name, row] of Object.entries(rows)) {
    const cohort = SETTLEMENT_COHORTS[name] || null;
    const settlements = count(row?.settlements);
    const amountAtomic = atomic(row?.amountAtomic);
    if (!cohort) {
      unmapped.push({ sourceClass: name, ledgerSettlements: settlements, ledgerAmountAtomic: amountAtomic });
      continue;
    }
    cohorts[cohort] = {
      sourceClass: name,
      ledgerSettlements: settlements,
      ledgerAmountAtomic: amountAtomic,
      coveredWindowSettlements: null,
      reason: "durable_ledger_row_not_assigned_to_the_covered_window",
    };
  }
  return { cohorts, unmapped };
}

function rareBounds(rare) {
  const coverage = rare?.coverage && typeof rare.coverage === "object" ? rare.coverage : {};
  return {
    retainedObservationStartUtcDay: day(coverage.retainedObservationStartUtcDay),
    retainedObservationEndUtcDay: day(coverage.retainedObservationEndUtcDay),
    retainedDurationWholeDays: count(coverage.retainedDurationWholeDays),
    retainedParseableRecordCount: count(coverage.retainedParseableRecordCount),
    requestedWindowComplete: coverage.requestedWindowComplete === true,
    captureContinuityProven: coverage.captureContinuityProven === true,
    integrityStatus: coverage.integrityStatus === "ok" ? "ok" : coverage.integrityStatus || null,
  };
}

function sameRareFile(left, right) {
  return left.retainedObservationStartUtcDay === right.retainedObservationStartUtcDay
    && left.retainedObservationEndUtcDay === right.retainedObservationEndUtcDay
    && left.retainedParseableRecordCount === right.retainedParseableRecordCount
    && left.retainedParseableRecordCount !== null;
}

function rareSlice(rare, reason) {
  if (!rare || typeof rare !== "object") {
    return observed(null, "rare_plane_absent");
  }
  const continuity = rare?.coverage?.captureContinuityProven === true;
  return {
    paymentHeaderEvents: observed(count(rare.paymentHeaderEvents), reason, { continuityProven: continuity }),
    parseableCredentialAttempts: observed(count(rare.parseableCredentialAttemptEvents), reason, { continuityProven: continuity }),
    unparseablePaymentHeaders: observed(count(rare.unparseablePaymentHeaderEvents), reason, { continuityProven: continuity }),
    paidSuccessEvents: observed(count(rare.paidSuccessEvents), reason, { continuityProven: continuity }),
    paidSuccessActorHashes: observed(count(rare.paidSuccessActors), reason, {
      continuityProven: continuity,
      actorHashIsIdentity: false,
    }),
    paymentErrorEvents: observed(count(rare.paymentErrorEvents), reason, { continuityProven: continuity }),
    byResult: countMap(rare.byResult),
    independentOperatorCount: rare.independentOperatorCount === null || rare.independentOperatorCount === undefined
      ? null
      : count(rare.independentOperatorCount),
    independentUsefulDemand: rare.independentUsefulDemand == null || rare.independentUsefulDemand === "unknown"
      ? "unknown"
      : "not_accepted",
  };
}

function streamSection(document, covered) {
  const reason = covered
    ? "retained_stream_events_inside_the_producer_complete_window_not_customers"
    : "requested_window_not_complete";
  return {
    coverage: covered ? "complete" : "unknown_for_full_window",
    externalEvents: observed(count(document.externalEvents), reason),
    challengeEvents: observed(count(document.byResult?.challenge), reason),
    discoveryEvents: observed(count(document.byResult?.discovery), reason),
    validationFailureEvents: observed(count(document.byResult?.validation_failure), reason),
    unmatchedEvents: observed(count(document.byResult?.unmatched), reason),
    protocolDiscoveryEvents: observed(count(document.byResult?.protocol_discovery), reason),
    paidSuccessEvents: observed(count(document.byResult?.paid_success), reason),
    paymentHeaderEvents: observed(count(document.paymentHeaderEvents), reason),
    parseableCredentialAttempts: observed(count(document.parseableCredentialAttemptEvents), reason),
    constructedRequestEvents: observed(count(document.constructedRequestEvents),
      "matched_constructed_request_challenges_across_external_and_crawler"),
    crawlerChallengeEvents: observed(count(document.agentChallengeObservations),
      "crawler_paid_route_challenges_not_external_request_events"),
    paidSuccessActorHashes: observed(count(document.paidSuccessActors), "stream_local_actor_hash_not_a_paying_customer"),
    independentPaidSuccessActorHashes: observed(
      count(document.independentPaidSuccessActors),
      "stream_zero_is_not_an_independent_customer_census",
    ),
    challengeActorHashes: observed(count(document.agentChallengeActors), "actor_hash_is_not_a_unique_agent"),
    challengeBySource: countMap(document.agentChallengeBySource),
    constructedRequestBySource: countMap(document.constructedRequestBySource),
    sourceCounterPopulations: {
      challengeBySource: {
        sourceField: "agentChallengeBySource",
        population: "crawler_paid_route_challenges",
        originClasses: ["crawler"],
        result: "challenge",
        totalSourceField: "agentChallengeObservations",
        observed: count(document.agentChallengeObservations),
        samePopulationAsExternalResults: false,
        coverage: "not_inferred_from_external_stream",
      },
      constructedRequestBySource: {
        sourceField: "constructedRequestBySource",
        population: "constructed_request_challenges",
        originClasses: ["external", "crawler"],
        result: "challenge",
        totalSourceField: "constructedRequestEvents",
        observed: count(document.constructedRequestEvents),
        samePopulationAsExternalResults: false,
        coverage: "not_inferred_from_external_stream",
      },
    },
    byResult: countMap(document.byResult),
  };
}

function policyContinuation(document) {
  const funnel = document.policyContractFunnel;
  if (!funnel || typeof funnel !== "object") return null;
  const rows = {};
  for (const [name, row] of Object.entries(funnel)) {
    if (!row || typeof row !== "object" || typeof row.paidRoute !== "string") continue;
    rows[name] = {
      paidRoute: row.paidRoute,
      contractReads: count(row.contractReads),
      challengeContinuationActors: count(row.challengeContinuationActors),
      credentialContinuationActors: count(row.credentialContinuationActors),
      paidDeliveryContinuationActors: count(row.paidDeliveryContinuationActors),
      actorHashIsIdentity: false,
      customerDenominator: null,
    };
  }
  return rows;
}

export function projectFunnelBaseline({ coveredDocument, rareDocument, coveredMeta, rareMeta, provenance }) {
  if (!coveredDocument || !coveredMeta?.url || !coveredMeta.sha256) {
    fail("public_aggregate_rejected", "covered read is missing");
  }
  const coveredReceipt = acceptAggregate(coveredDocument, coveredMeta);
  const windowComplete = coveredDocument.requestedWindowComplete === true
    && coveredDocument.requestedWindowCoverage === "complete";
  const coveredRare = rareBounds(coveredDocument.durableRareFunnel);
  let rareContext = null;
  let rareContextStatus = "not_read";
  if (rareDocument) {
    if (!rareMeta?.url || !rareMeta.sha256) fail("public_aggregate_rejected", "rare-context read is missing");
    acceptAggregate(rareDocument, rareMeta);
    const wideRare = rareBounds(rareDocument.durableRareFunnel);
    if (!sameRareFile(coveredRare, wideRare)) {
      rareContextStatus = "conflicting_reads";
      rareContext = { status: rareContextStatus, file: wideRare, slice: null };
    } else if (wideRare.captureContinuityProven) {
      rareContextStatus = "continuity_claim_not_accepted";
      rareContext = { status: rareContextStatus, file: wideRare, slice: null };
    } else {
      rareContextStatus = "retained_file_context_not_a_covered_census";
      rareContext = {
        status: rareContextStatus,
        file: wideRare,
        requestedDays: count(rareDocument.requestedWindowDays),
        slice: rareSlice(
          rareDocument.durableRareFunnel,
          "retained_rare_rows_inside_the_wide_request_continuity_unproven_not_the_covered_window",
        ),
      };
    }
  }

  const settlement = coveredDocument.paymentEvidence?.settlementPlane || {};
  const settlementCoverageFlag = settlement.coverage === "complete" ? "complete" : "unknown_for_full_window";
  const { cohorts, unmapped } = ledgerCohorts(settlement.byClass);
  const eventPlane = coveredDocument.paymentEvidence?.eventPlane || {};
  const baseline = {
    schema: BASELINE_SCHEMA,
    jobId: JOB_ID,
    individualJoin: false,
    recognizedRevenueAtomic: "0",
    merchantWrite: false,
    pins: {
      sourceCommit: SOURCE_COMMIT,
      merchant157: MERCHANT157,
      relayUnion: RELAY_UNION,
      seller041: "frozen_not_rewritten",
      shared421Patches: "unapplied",
    },
    acquisition: {
      covered: coveredMeta,
      rareContext: rareMeta || null,
    },
    coveredWindow: {
      selected: windowComplete,
      requestedDays: count(coveredDocument.requestedWindowDays),
      expectedDays: COVERED_DAYS,
      start: typeof coveredDocument.requestedWindowStart === "string" ? coveredDocument.requestedWindowStart : null,
      end: typeof coveredDocument.requestedWindowEnd === "string" ? coveredDocument.requestedWindowEnd : null,
      generatedAt: typeof coveredDocument.generatedAt === "string" ? coveredDocument.generatedAt : null,
      requestedWindowCoverage: windowComplete ? "complete" : "unknown_for_full_window",
      retainedCompleteUtcDays: count(coveredDocument.coverage?.retainedDurationWholeDays),
      retainedObservationStartUtcDay: day(coveredDocument.coverage?.retainedObservationStartUtcDay),
      retainedObservationEndUtcDay: day(coveredDocument.coverage?.retainedObservationEndUtcDay),
      selectionRule: "producer requestedWindowComplete on the existing commerce-demand route; no synthetic range",
    },
    stream: streamSection(coveredDocument, windowComplete),
    rareCoveredSlice: rareSlice(
      coveredDocument.durableRareFunnel,
      "rare_rows_whose_timestamps_fall_in_the_covered_request_continuity_unproven",
    ),
    rareFile: {
      ...coveredRare,
      context: rareContext,
      contextDays: RARE_CONTEXT_DAYS,
    },
    settlementLedger: {
      assignedToCoveredWindow: false,
      coverageFlag: settlementCoverageFlag,
      coverageFlagMeans: "baseline_is_at_or_before_the_requested_window_start_not_a_windowed_count",
      relationship: coveredReceipt.aggregate?.relationship || null,
      ledgerSettlements: count(settlement.reconciledSettlements),
      ledgerAmountAtomic: atomic(settlement.amountAtomic),
      amountIsRevenue: false,
      coveredWindowSettlements: null,
      cohorts,
      unmapped,
      closedSponsoredExpense: {
        class: coveredReceipt.sponsoredExpense?.class || null,
        atomic: coveredReceipt.sponsoredExpense?.atomic || null,
        secondPay: false,
        recognizedRevenue: false,
        includedInLedgerCohorts: false,
      },
    },
    journey: {
      attempts: observed(null, "no_per_attempt_identity_on_the_public_route"),
      deliverySuccess: observed(null, "seller_paid_success_is_not_buyer_valid_delivery"),
      deliveryFailure: observed(null, "stream_and_rare_failures_are_not_one_denominator"),
      independentlyUseful: observed(null, "usefulness_requires_separate_authority"),
      authorizedRetention: observed(null, "production_retention_port_not_enrolled"),
      laterUse: observed(null, "repeat_actor_hash_is_not_later_use"),
      settlement: observed(null, "ledger_is_not_joined_to_an_attempt"),
      payingCustomers: observed(null, "headers_wallets_and_settlements_are_not_customers"),
      uniqueAgents: observed(null, "actor_hash_is_not_a_unique_agent"),
    },
    customerPlane: {
      attributableCustomerCount: null,
      buyerValidDeliveryCount: null,
      repeatIndependentCustomerCount: null,
    },
    eventPlanePaidActors: {
      coverage: eventPlane.coverage || null,
      requestedWindowPaidSuccessActors: count(eventPlane.requestedWindowPaidSuccessActors),
      copiedFromStream: true,
      census: false,
      reason: "complete_stream_coverage_copies_the_stream_local_paid_actor_count_and_does_not_cover_the_rare_plane",
    },
    policyContinuation: policyContinuation(coveredDocument),
    missing: [
      "per_attempt_public_call_id",
      "buyer_valid_delivery",
      "independently_useful_output",
      "authorized_retention",
      "later_use_of_the_same_attempt",
      "windowed_settlement",
      "cross_rail_join",
      "later_repeat_same_call_id",
      "sluzen_public_example",
      "caller_supplied_task",
    ],
    missingLink: {
      id: "per_attempt_public_call_identity",
      status: "absent",
      why: "The covered stream window has no per-attempt id that joins challenge, delivery, settlement, independent usefulness, authorized retention, and later use. Sluzen describes a private per-attempt callId. Its public example, cross-rail join, and later-repeat join are absent.",
    },
    provenance: {
      route: PUBLIC_ROUTE,
      reader: "existing_projectPublicAggregate_plus_isolated_funnel_projection",
      merchantBuilderPatch: "not_required",
      seller041: "unchanged",
      ...provenance,
    },
  };
  if (containsRestrictedKey(baseline)) fail("restricted_fields", "baseline projection kept a restricted field");
  return baseline;
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}
