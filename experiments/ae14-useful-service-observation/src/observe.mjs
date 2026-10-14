import { isHistoricalV1PaidSuccess } from "../../../http-delivery-evidence/historical.mjs";
import { openStore } from "../../../http-delivery-evidence/store.mjs";
import {
  BLIND_SPOTS,
  COVERAGE_GAP,
  COVERAGE_RESULT,
  COVERAGE_WINDOW,
  E08_USEFUL_WORK,
  E18_HEAD_USED,
  OBSERVATION_SCHEMA,
  TX,
  USEFULNESS_UNKNOWN,
  isSchemaValidDelivery,
} from "./contract.mjs";

function paidRows(historical) {
  return historical
    .filter((item) => item.kind === "historical_v1_not_checked" && isHistoricalV1PaidSuccess(item.row))
    .map((item) => item.row);
}

function sameReference(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

function blankRepeat(reason) {
  return {
    class: "unknown",
    countsAsRepeatPurchase: false,
    countsAsEntitledReuse: false,
    boundToPriorPaidResult: false,
    payment: "unknown",
    link: "absent",
    pseudonymAlsoMatches: false,
    reason,
  };
}

function deliveryPlane(paid, validations) {
  if (!paid) {
    return {
      evidence: "absent",
      schemaValid: "unknown",
      deliveryClass: null,
      validatorVerdict: null,
      usefulness: USEFULNESS_UNKNOWN,
      reason: "missing_capture",
      httpStatusIsNotUsefulness: true,
    };
  }
  const matches = validations.filter((row) => (
    row.paidEvidenceId === paid.id
    && row.method === paid.method
    && row.resource === paid.route
    && row.requestDigest === paid.requestDigest
    && row.responseDigest === paid.responseDigest
    && sameReference(row.settlementReference, paid.settlementReference)
    && row.usefulness === USEFULNESS_UNKNOWN
  ));
  if (matches.length === 0) {
    return {
      evidence: "paid_without_validation",
      schemaValid: "unknown",
      deliveryClass: null,
      validatorVerdict: null,
      usefulness: USEFULNESS_UNKNOWN,
      reason: "validation_absent",
      httpStatusIsNotUsefulness: true,
    };
  }
  if (matches.length > 1) {
    const verdicts = new Set(matches.map((row) => row.validatorVerdict));
    if (verdicts.size > 1) {
      return {
        evidence: "conflicting",
        schemaValid: "unknown",
        deliveryClass: null,
        validatorVerdict: null,
        usefulness: USEFULNESS_UNKNOWN,
        reason: "validation_conflict",
        httpStatusIsNotUsefulness: true,
      };
    }
  }
  const validation = matches[0];
  const schemaValid = isSchemaValidDelivery(validation) ? true : validation.validatorVerdict === "invalid" ? false : "unknown";
  return {
    evidence: "observed",
    schemaValid,
    deliveryClass: validation.deliveryClass,
    validatorVerdict: validation.validatorVerdict,
    usefulness: USEFULNESS_UNKNOWN,
    reason: schemaValid === true ? "schema_valid_response" : "schema_not_buyer_useful",
    httpStatusIsNotUsefulness: true,
    settlementPresent: TX.test(String(paid.settlementReference || "").toLowerCase()),
  };
}

function declaredPlane(feedback, extension) {
  const disposition = feedback?.disposition ?? extension?.disposition ?? null;
  const distinct = new Set([feedback?.disposition, extension?.disposition].filter(Boolean));
  const conflict = distinct.size > 1;
  return {
    evidence: feedback || extension ? "caller_declared" : "absent",
    usefulnessDisposition: conflict ? "unknown" : (disposition || "unknown"),
    reasonCategory: extension?.reasonCategory ?? feedback?.reasonCategory ?? null,
    retainedUse: extension?.kind === "decline" ? "unknown" : (extension?.retainedUse || "unknown"),
    nextTask: extension?.nextTask || null,
    priorBinding: extension?.priorBinding
      ? { paidEvidenceId: extension.priorBinding.paidEvidenceId, taskRef: extension.priorBinding.taskRef }
      : null,
    declined: extension?.kind === "decline",
    originLabel: extension?.originLabel || "unknown",
    usefulnessMeasurement: USEFULNESS_UNKNOWN,
    reason: conflict ? "declaration_conflict" : feedback || extension ? "caller_declared" : "declaration_absent",
  };
}

function laterPaid(paids, id) {
  const rows = paids.filter((row) => row.id === id);
  if (rows.length !== 1) return null;
  return rows[0];
}

function purchaseShape(prior, later, taskRef, priorTaskRef, relation) {
  if (!prior || !later || later.id === prior.id) return { ok: false, reason: "later_result_missing" };
  if (!TX.test(String(later.settlementReference || "").toLowerCase())) return { ok: false, reason: "settlement_unbound" };
  const sameRequest = later.requestDigest === prior.requestDigest;
  const sameTask = typeof taskRef === "string" && typeof priorTaskRef === "string" && taskRef === priorTaskRef;
  if (relation === "none") return { ok: false, reason: "no_next_task" };
  if (relation === "same_task" || sameRequest || sameTask) {
    return { ok: true, class: "same_task_retry", reason: sameRequest ? "same_request_digest" : "same_task_ref" };
  }
  if (relation === "distinct_later_task" && taskRef && priorTaskRef && taskRef !== priorTaskRef) {
    return { ok: true, class: "distinct_later_task_purchase", reason: "distinct_task_and_later_settlement" };
  }
  return { ok: false, reason: "task_unbound" };
}

export function classifyRepeat({ prior, paids, handbacks, continuations }) {
  if (!prior) return blankRepeat("missing_capture");
  const candidates = [];
  for (const handback of handbacks) {
    if (handback.kind !== "handback" || !handback.priorBinding) continue;
    if (handback.priorBinding.paidEvidenceId !== prior.id) continue;
    const later = laterPaid(paids, handback.paidEvidenceId);
    const shape = purchaseShape(
      prior,
      later,
      handback.nextTask?.taskRef || null,
      handback.priorBinding.taskRef,
      handback.nextTask?.relation || "none",
    );
    if (!shape.ok) continue;
    candidates.push({
      class: shape.class,
      reason: shape.reason,
      payment: "observed",
      link: "caller_declared",
      boundToPriorPaidResult: true,
      pseudonymAlsoMatches: false,
    });
  }
  for (const continuation of continuations) {
    if (continuation.priorPaidEvidenceId !== prior.id) continue;
    if (continuation.access === "pseudonym_only") {
      candidates.push({
        class: "pseudonym_continuity",
        reason: "matched_request_pseudonym_is_not_independent_control",
        payment: "not_a_purchase_link",
        link: "pseudonym",
        boundToPriorPaidResult: false,
        pseudonymAlsoMatches: true,
      });
      continue;
    }
    if (continuation.access === "free_entitled") {
      candidates.push({
        class: "entitled_reuse",
        reason: "free_entitled_retrieval",
        payment: "absent",
        link: continuation.synthetic === true ? "synthetic_observed" : "observed",
        boundToPriorPaidResult: true,
        pseudonymAlsoMatches: continuation.actorContinuity === "pseudonym",
      });
      continue;
    }
    if (continuation.access === "purchased") {
      const later = laterPaid(paids, continuation.laterPaidEvidenceId);
      const relation = continuation.taskRef && continuation.priorTaskRef && continuation.taskRef !== continuation.priorTaskRef
        ? "distinct_later_task"
        : "same_task";
      const shape = purchaseShape(prior, later, continuation.taskRef, continuation.priorTaskRef, relation);
      if (!shape.ok) continue;
      candidates.push({
        class: shape.class,
        reason: shape.reason,
        payment: "observed",
        link: continuation.synthetic === true ? "synthetic_observed" : "observed",
        boundToPriorPaidResult: true,
        pseudonymAlsoMatches: continuation.actorContinuity === "pseudonym",
      });
    }
  }
  const rank = {
    distinct_later_task_purchase: 4,
    same_task_retry: 3,
    entitled_reuse: 2,
    pseudonym_continuity: 1,
  };
  candidates.sort((left, right) => (rank[right.class] || 0) - (rank[left.class] || 0));
  const best = candidates[0];
  if (!best) return blankRepeat("repeat_not_observed");
  return {
    class: best.class,
    countsAsRepeatPurchase: best.class === "distinct_later_task_purchase",
    countsAsEntitledReuse: best.class === "entitled_reuse",
    boundToPriorPaidResult: best.boundToPriorPaidResult === true,
    payment: best.payment,
    link: best.link,
    pseudonymAlsoMatches: best.pseudonymAlsoMatches === true,
    reason: best.reason,
  };
}

export function observeLoaded({
  paidEvidenceId,
  paids,
  validations,
  feedbackDeclarations,
  extensionRows,
  tenant,
  windowCoverage = COVERAGE_WINDOW,
}) {
  const copies = paids.filter((row) => row.id === paidEvidenceId);
  const paid = copies.length === 1 ? copies[0] : null;
  const duplicatePaid = copies.length > 1;
  const feedbackMatches = (feedbackDeclarations || []).filter((item) => item?.paidEvidenceId === paidEvidenceId);
  const feedbackSame = paid
    ? feedbackMatches.filter((item) => item.requestDigest === paid.requestDigest && sameReference(item.settlementReference, paid.settlementReference))
    : feedbackMatches;
  const feedback = feedbackSame.length === 1 ? feedbackSame[0] : null;
  const ownExtension = (extensionRows || []).filter((row) => row.paidEvidenceId === paidEvidenceId && row.tenant === tenant);
  const extension = ownExtension.find((row) => row.kind === "handback") || ownExtension.find((row) => row.kind === "decline") || null;
  const delivered = duplicatePaid
    ? { ...deliveryPlane(null, []), reason: "duplicate_capture", evidence: "conflicting", schemaValid: "unknown" }
    : deliveryPlane(paid, validations);
  const declared = declaredPlane(feedback, extension);
  if (feedbackSame.length > 1) {
    declared.usefulnessDisposition = "unknown";
    declared.reason = "declaration_conflict";
  } else if (feedbackMatches.length > 0 && feedbackSame.length === 0) {
    declared.usefulnessDisposition = "unknown";
    declared.evidence = "absent";
    declared.reason = "identity_mismatch";
  }
  const repeat = classifyRepeat({
    prior: paid,
    paids,
    handbacks: (extensionRows || []).filter((row) => row.kind === "handback" && row.tenant === tenant),
    continuations: (extensionRows || []).filter((row) => row.kind === "continuation" && row.tenant === tenant),
  });
  const gap = windowCoverage === COVERAGE_GAP;
  const qualifiedRepeat = gap ? blankRepeat("source_gap_stays_unknown") : repeat;
  return {
    schema: OBSERVATION_SCHEMA,
    paidEvidenceId,
    coverage: extension || feedback ? COVERAGE_RESULT : COVERAGE_WINDOW,
    windowCoverage: gap ? COVERAGE_GAP : COVERAGE_WINDOW,
    notAWindowDenominator: true,
    absenceIsNotFailure: true,
    absenceIsNotNoRepeat: true,
    outsideUsefulAnswerArrived: false,
    outsideCustomer: null,
    e08UsefulWork: E08_USEFUL_WORK,
    delivered,
    declared,
    observedRepeat: qualifiedRepeat,
    retainedRepeatFact: gap ? repeat : null,
    withheldBecauseGap: gap,
    originLabel: declared.originLabel,
    freshness: extension?.receivedAt || null,
    hJoin: { status: "pending-join", ran: false },
  };
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

export function reportLoaded(input) {
  const ids = new Set();
  for (const paid of input.paids) ids.add(paid.id);
  for (const row of input.extensionRows || []) {
    if (row.paidEvidenceId) ids.add(row.paidEvidenceId);
  }
  const observations = [...ids].sort().map((paidEvidenceId) => observeLoaded({ ...input, paidEvidenceId }));
  const labels = { owner_qa: 0, sponsored: 0, external_unknown: 0, unknown: 0 };
  const tally = {
    rowsRead: observations.length,
    deliveredSchemaValid: 0,
    deliveredSchemaInvalid: 0,
    deliveredUnknown: 0,
    declaredUseful: 0,
    declaredNotUseful: 0,
    declaredRetained: 0,
    declaredNotRetained: 0,
    declaredDeclined: 0,
    declarationUnknown: 0,
    observedDistinctLaterTaskPurchases: 0,
    observedEntitledReuses: 0,
    observedSameTaskRetries: 0,
    observedPseudonymContinuity: 0,
    repeatUnknown: 0,
  };
  let newest = null;
  for (const row of observations) {
    if (row.delivered.schemaValid === true) tally.deliveredSchemaValid += 1;
    else if (row.delivered.schemaValid === false) tally.deliveredSchemaInvalid += 1;
    else tally.deliveredUnknown += 1;
    if (row.declared.usefulnessDisposition === "useful") tally.declaredUseful += 1;
    else if (row.declared.usefulnessDisposition === "not_useful") tally.declaredNotUseful += 1;
    else tally.declarationUnknown += 1;
    if (row.declared.retainedUse === "retained") tally.declaredRetained += 1;
    else if (row.declared.retainedUse === "not_retained") tally.declaredNotRetained += 1;
    if (row.declared.declined === true) tally.declaredDeclined += 1;
    if (row.observedRepeat.class === "distinct_later_task_purchase") tally.observedDistinctLaterTaskPurchases += 1;
    else if (row.observedRepeat.class === "entitled_reuse") tally.observedEntitledReuses += 1;
    else if (row.observedRepeat.class === "same_task_retry") tally.observedSameTaskRetries += 1;
    else if (row.observedRepeat.class === "pseudonym_continuity") tally.observedPseudonymContinuity += 1;
    else tally.repeatUnknown += 1;
    increment(labels, labels[row.originLabel] === undefined ? "unknown" : row.originLabel);
    if (row.freshness && (!newest || row.freshness > newest)) newest = row.freshness;
  }
  return {
    schema: OBSERVATION_SCHEMA,
    windowCoverage: input.windowCoverage === COVERAGE_GAP ? COVERAGE_GAP : COVERAGE_WINDOW,
    notAWindowDenominator: true,
    rates: null,
    outsideCustomerCount: null,
    outsideUsefulAnswerArrived: false,
    unclassifiedSettlementsAreNotCustomers: true,
    absenceIsNotFailure: true,
    absenceIsNotNoRepeat: true,
    e08UsefulWork: E08_USEFUL_WORK,
    measurement: {
      writer: "experiments/contributor-network-measurement-227900",
      ingested: false,
      pendingJoin: "E18",
      e18HeadUsed: E18_HEAD_USED,
    },
    hJoin: { status: "pending-join", ran: false },
    tally,
    labels,
    freshness: newest || "unknown",
    blindSpots: [...BLIND_SPOTS],
    rejectedExtensionRows: input.rejectedExtensionRows || 0,
    observations,
  };
}

export async function loadObservationInputs(dataDir) {
  const store = openStore(dataDir);
  const historical = await store.readHistorical();
  const validations = await store.readValidations();
  return {
    paids: paidRows(historical),
    validations,
    reads: 2,
  };
}
