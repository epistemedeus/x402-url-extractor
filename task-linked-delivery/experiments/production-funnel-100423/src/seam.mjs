import { projectBundle, replayRetained } from "../../free-task-observation-100421/src/project.mjs";
import { isRestrictedKey } from "../../../tools/ops/three-site-settlement-join/measure/src/restricted.mjs";
import {
  ATTEMPT_COHORTS,
  EVIDENCE_KINDS,
  PHASE_KEYS,
  PHASES,
  RAILS,
} from "./constants.mjs";
import { fail } from "./errors.mjs";

const CALL_ID = /^[A-Za-z0-9_-]{8,80}$/;
const ROUTE = /^\/[A-Za-z0-9._/-]{1,120}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TX = /^0x[0-9a-f]{64}$/;

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function phaseId(phase) {
  return JSON.stringify([
    phase.callId,
    phase.rail,
    phase.phase,
    phase.route,
    phase.httpStatus,
    phase.settlementReference,
    phase.bodyDigest,
    phase.cohort,
  ]);
}

function checkPhase(phase) {
  if (!phase || typeof phase !== "object" || Array.isArray(phase)) fail("wrong_join", "phase is not an object");
  for (const key of Object.keys(phase)) {
    if (isRestrictedKey(key)) fail("wallet_or_header_is_not_identity", "a header or wallet cannot identify the caller");
  }
  if (!sameKeys(phase, PHASE_KEYS)) fail("wrong_join", "phase fields are not the attempt cut");
  if (!CALL_ID.test(phase.callId) || !RAILS.has(phase.rail) || !PHASES.has(phase.phase)) {
    fail("wrong_join", "call, rail, or phase is not in the cut");
  }
  if (!EVIDENCE_KINDS.has(phase.evidenceKind)) fail("wrong_join", "production rows are not supplied phases");
  if (!ROUTE.test(phase.route) || !ATTEMPT_COHORTS.has(phase.cohort)) fail("wrong_join", "route or cohort is not in the cut");
  if (phase.httpStatus !== null && (!Number.isInteger(phase.httpStatus) || phase.httpStatus < 100 || phase.httpStatus > 599)) {
    fail("wrong_join", "HTTP status is not a status code");
  }
  if (phase.settlementReference !== null && !TX.test(phase.settlementReference)) fail("wrong_join", "settlement reference is not a reference");
  if (phase.bodyDigest !== null && !HEX64.test(phase.bodyDigest)) fail("wrong_join", "body digest is not a digest");
  if (phase.phase === "delivery" && phase.httpStatus === null) fail("missing_cut", "delivery has no status");
  if (phase.phase === "settlement" && phase.settlementReference === null) fail("missing_cut", "settlement has no reference");
}

function blankAttempt(callId, rail, cohort) {
  return {
    callId,
    rail,
    cohort,
    challenge: false,
    delivery: "unknown",
    settlement: "unknown",
    laterUse: "unknown",
    independentlyUseful: null,
    authorizedRetention: null,
    customer: null,
    refusals: [],
  };
}

// Supplied phases are a caller cut or a fixture. They never promote the public
// aggregate, a wallet, or a header into a customer, and they never join rails.
function countKnown(attempts, statusOf, match) {
  if (attempts.length === 0) return null;
  const statuses = attempts.map(statusOf);
  if (statuses.some((status) => status === "unknown")) return null;
  return statuses.filter((status) => status === match).length;
}

export function joinSuppliedPhases(phases, options = {}) {
  if (options.inheritAcrossCallIds === true) {
    fail("later_repeat_join_absent", "a new attempt does not inherit usefulness from an earlier call id");
  }
  if (!Array.isArray(phases) || phases.length === 0) {
    return {
      decision: "missing_cut",
      attempts: { observed: null, census: false, customerDenominator: null },
      deliverySuccess: { observed: null, census: false },
      deliveryFailure: { observed: null, census: false },
      settlement: { observed: null, census: false },
      independentlyUseful: { observed: null, reason: "no_separate_predicate_authority" },
      authorizedRetention: { observed: null, reason: "no_retention_port_in_this_cut" },
      laterUse: { observed: null, reason: "missing_cut" },
      duplicatesCollapsed: 0,
      refusals: ["missing_cut"],
      journeys: [],
    };
  }
  for (const phase of phases) checkPhase(phase);
  const groups = new Map();
  let duplicatesCollapsed = 0;
  for (const phase of phases) {
    const key = `${phase.rail}\n${phase.callId}`;
    const group = groups.get(key) || { phases: [], seen: new Set(), cohort: phase.cohort, conflict: null };
    if (group.cohort !== phase.cohort) group.conflict = "cohort_conflict";
    const id = phaseId(phase);
    if (group.seen.has(id)) duplicatesCollapsed += 1;
    else {
      group.seen.add(id);
      group.phases.push(phase);
    }
    groups.set(key, group);
  }
  const byCall = new Map();
  for (const [key, group] of groups) {
    const callId = key.split("\n")[1];
    const rails = byCall.get(callId) || [];
    rails.push({ rail: key.split("\n")[0], group });
    byCall.set(callId, rails);
  }
  const journeys = [];
  const refusals = [];
  for (const [callId, rails] of byCall) {
    if (rails.length > 1) {
      refusals.push({ callId, reason: "cross_rail_join_absent" });
      continue;
    }
    const { rail, group } = rails[0];
    const attempt = blankAttempt(callId, rail, group.cohort);
    if (group.conflict) {
      attempt.refusals.push(group.conflict);
      journeys.push(attempt);
      refusals.push({ callId, reason: "wrong_join" });
      continue;
    }
    const deliveries = group.phases.filter((phase) => phase.phase === "delivery");
    const settlements = group.phases.filter((phase) => phase.phase === "settlement");
    const later = group.phases.filter((phase) => phase.phase === "later_read");
    attempt.challenge = group.phases.some((phase) => phase.phase === "challenge");
    if (deliveries.length > 1 || settlements.length > 1 || later.length > 1) {
      attempt.delivery = "unknown";
      attempt.settlement = "unknown";
      attempt.laterUse = "unknown";
      attempt.refusals.push("wrong_join");
      refusals.push({ callId, reason: "wrong_join" });
      journeys.push(attempt);
      continue;
    }
    const delivery = deliveries[0] || null;
    const settlement = settlements[0] || null;
    const laterRead = later[0] || null;
    if (!delivery) attempt.delivery = "unknown";
    else if (delivery.httpStatus >= 200 && delivery.httpStatus < 300) attempt.delivery = "success";
    else if (delivery.httpStatus >= 400) attempt.delivery = "failure";
    else attempt.delivery = "unknown";
    if (!settlement) attempt.settlement = "unknown";
    else if (delivery?.settlementReference && delivery.settlementReference !== settlement.settlementReference) {
      attempt.settlement = "unknown";
      attempt.refusals.push("wrong_join");
      refusals.push({ callId, reason: "wrong_join" });
    } else attempt.settlement = "observed";
    if (!laterRead) attempt.laterUse = "unknown";
    else if (delivery?.bodyDigest && laterRead.bodyDigest && delivery.bodyDigest !== laterRead.bodyDigest) {
      attempt.laterUse = "unknown";
      attempt.refusals.push("changed_later_input");
      refusals.push({ callId, reason: "changed_later_input" });
    } else if (delivery?.bodyDigest && laterRead.bodyDigest === delivery.bodyDigest) {
      attempt.laterUse = "same_digest_read_usefulness_unknown";
    } else attempt.laterUse = "unknown";
    journeys.push(attempt);
  }
  const counted = journeys.filter((attempt) => attempt.refusals.length === 0);
  const noAcceptedAttempt = counted.length === 0;
  return {
    decision: refusals.length ? "reject" : "joined",
    attempts: {
      observed: noAcceptedAttempt ? null : counted.length,
      rejected: journeys.length - counted.length,
      census: false,
      customerDenominator: null,
    },
    deliverySuccess: {
      observed: countKnown(counted, (attempt) => attempt.delivery, "success"),
      census: false,
    },
    deliveryFailure: {
      observed: countKnown(counted, (attempt) => attempt.delivery, "failure"),
      census: false,
    },
    settlement: {
      observed: countKnown(counted, (attempt) => attempt.settlement, "observed"),
      census: false,
    },
    independentlyUseful: { observed: null, reason: "no_separate_predicate_authority" },
    authorizedRetention: { observed: null, reason: "no_retention_port_in_this_cut" },
    laterUse: {
      observed: countKnown(counted, (attempt) => attempt.laterUse, "same_digest_read_usefulness_unknown"),
      usefulness: "unknown",
      census: false,
    },
    duplicatesCollapsed,
    refusals,
    journeys,
  };
}

export function refuseFalseComplete(baseline, proposal) {
  if (!baseline || baseline.schema !== "samedaydesk.production-funnel-baseline.v1") {
    fail("public_aggregate_rejected", "baseline schema is not the funnel baseline");
  }
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    fail("wrong_join", "proposal is missing");
  }
  const reasons = [];
  if (proposal.census === true) reasons.push("rare_zero_is_not_census");
  if (proposal.payingCustomers != null) reasons.push("settlement_is_not_customer");
  if (proposal.uniqueAgentsFromActors === true || proposal.uniqueAgentsFromHeaders === true) {
    reasons.push("actor_or_header_is_not_agent");
  }
  if (proposal.windowPaidDeliveries != null && baseline.settlementLedger?.assignedToCoveredWindow !== true) {
    reasons.push("ledger_is_not_window_count");
  }
  if (proposal.windowPaidDeliveries === 0 && baseline.rareFile?.captureContinuityProven !== true) {
    reasons.push("stream_zero_does_not_cover_rare_plane");
  }
  if (proposal.joinSluzenCallId === true || proposal.crossRail === true) reasons.push("cross_rail_join_absent");
  if (proposal.publicExample === true && !Array.isArray(proposal.phases)) reasons.push("public_example_absent");
  if (proposal.laterRepeatInheritsUsefulness === true) reasons.push("later_repeat_join_absent");
  if (proposal.productionPopulation === true) reasons.push("owner_qa_is_not_production");
  if (reasons.length === 0) fail("wrong_join", "proposal did not ask for a refused join");
  return {
    decision: "reject",
    reasons: [...new Set(reasons)].sort(),
    recognizedRevenueAtomic: "0",
    customerDenominator: null,
    coveredWindowSettlements: null,
  };
}

export function readObservationPort(bundle) {
  const report = projectBundle(bundle);
  const useful = report.journeys.filter((journey) => journey.stages.independently_replayed_output.status === "observed");
  return {
    evidenceKind: "owner_qa_free_observation_not_production",
    populationJoinsProductionRareRows: false,
    paymentPermitted: false,
    recognizedRevenueAtomic: report.recognizedRevenueAtomic,
    journeys: report.journeys.length,
    cohorts: [...new Set(report.journeys.map((journey) => journey.cohort))].sort(),
    independentlyUseful: {
      observed: useful.length,
      denominator: report.rates.independently_replayed_output.denominator,
      usefulness: useful.map((journey) => journey.usefulness).sort(),
    },
    authorizedRetention: {
      observed: report.journeys.filter((journey) => journey.stages.authorized_retention.status === "observed").length,
      denominator: report.rates.authorized_retention.denominator,
    },
    laterUse: {
      observed: report.journeys.filter((journey) => journey.stages.later_use.status === "observed").length,
      denominator: report.rates.later_use.denominator,
    },
    settlement: "unknown",
  };
}

export function refuseObservationAsProduction(observation, proposal) {
  if (observation?.populationJoinsProductionRareRows !== false) fail("owner_qa_is_not_production");
  if (proposal?.productionPopulation === true || proposal?.countsAsCoveredWindow === true) {
    fail("owner_qa_is_not_production", "owner QA observation is not the production window");
  }
  return { decision: "kept_separate", productionAttemptsJoined: null };
}

export function rejectChangedRetention(receipt) {
  try {
    replayRetained(receipt);
  } catch (error) {
    if (error.code === "replay_mismatch") {
      return { decision: "reject", reason: "replay_mismatch", inheritedUsefulness: null };
    }
    throw error;
  }
  fail("wrong_join", "changed retention was accepted");
}
