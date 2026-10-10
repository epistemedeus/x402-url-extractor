// Read-only join of one canonical settlement to its captured delivery.
// Identity is paidEvidenceId plus digest, route, and settlement reference.
// Aggregate route counts are not a join. Schema validity is not buyer usefulness.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { isCanonicalMcpTypedCommerceEvent } from "./commerce-events.mjs";
import { SCHEMA_VERSION } from "./commerce-settlement-reconciler.mjs";
import { buildCommercePaymentEvidenceReadout } from "./commerce-payment-evidence.mjs";
import {
  FORWARD_BINDING_FILENAME,
  FORWARD_BINDING_ROTATED_FILENAME,
  TASK_REF_FILENAME,
  TASK_REF_ROTATED_FILENAME,
  isForwardV2Record,
  isSchemaValidDeliveryEvidence,
  isTaskRefRecord,
} from "./commerce-outcome-binding.mjs";
import { declareCallerUsefulness } from "./http-delivery-evidence/caller-declaration.mjs";
import {
  CALLER_RESULT_FEEDBACK_FILENAME,
  CALLER_RESULT_FEEDBACK_ROTATED_FILENAME,
  createCallerResultFeedbackService,
} from "./caller-result-feedback.mjs";
import { digestMcpCallId, digestMcpDeliveryBinding } from "./http-delivery-evidence/digest.mjs";
import {
  PAID_EVIDENCE_FILENAME,
  PAID_EVIDENCE_ID_PATTERN,
  isHistoricalV1PaidSuccess,
  parseNdjson,
} from "./http-delivery-evidence/historical.mjs";
import {
  MCP_DELIVERY_FILENAME,
  MCP_MORPHO_RESOURCE,
  MCP_MORPHO_TOOL,
  canonicalizeMcpDeliveryRecord,
} from "./http-delivery-evidence/mcp-delivery.mjs";
import {
  VALIDATION_FILENAME,
  canonicalizeValidationRecord,
  validationAttachesToHistorical,
} from "./http-delivery-evidence/store.mjs";

export const PRODUCER_BASE_SHA = "cbfed005c5200f76feb419ebb3a4ce8ffee49644";
export const REPORT_SCHEMA = "samedaydesk.ordinary-delivery-join.v1";
export const CALLER_FEEDBACK_AGGREGATE_SCHEMA = "samedaydesk.caller-result-feedback-aggregate.v1";
export const SETTLEMENT_LEDGER_FILENAME = "commerce-settlements.ndjson";

export const COMMERCE_EVENTS_FILENAME = "commerce-events.ndjson";
export const COMMERCE_EVENTS_ROTATED_FILENAME = "commerce-events.1.ndjson";
export const FILE_CLASSES = Object.freeze({
  settlementLedger: SETTLEMENT_LEDGER_FILENAME,
  paidSuccessEvidence: PAID_EVIDENCE_FILENAME,
  commerceEvents: COMMERCE_EVENTS_FILENAME,
  commerceEventsRotated: COMMERCE_EVENTS_ROTATED_FILENAME,
  httpValidation: VALIDATION_FILENAME,
  mcpDelivery: MCP_DELIVERY_FILENAME,
  outcomeBinding: FORWARD_BINDING_FILENAME,
  outcomeBindingRotated: FORWARD_BINDING_ROTATED_FILENAME,
  taskRef: TASK_REF_FILENAME,
  taskRefRotated: TASK_REF_ROTATED_FILENAME,
  callerResultFeedback: CALLER_RESULT_FEEDBACK_FILENAME,
  callerResultFeedbackRotated: CALLER_RESULT_FEEDBACK_ROTATED_FILENAME,
});

const TYPED_DELIVERY_RESULTS = new Set([
  "paid_success",
  "application_failure",
  "replay_success",
  "settlement_failure",
]);
const DIGEST_RE = /^[0-9a-f]{64}$/;

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const COMPLETE_CLASSES = new Set(["full_bounded_capture", "complete_useful", "useful_negative", "source_refusal"]);
const CALLER_SOURCES = new Set(["caller"]);

function inWindow(iso, startMs, endMs) {
  const value = Date.parse(iso || "");
  return Number.isFinite(value) && value >= startMs && value <= endMs;
}

async function readText(dir, name) {
  try {
    return await readFile(path.join(dir, name), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function canonicalSettlement(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  if (record.schemaVersion !== SCHEMA_VERSION || record.state !== "reconciled") return null;
  if (!TX_RE.test(String(record.settlementReference || ""))) return null;
  if (!PAID_EVIDENCE_ID_PATTERN.test(String(record.sourceEventId || ""))) return null;
  if (!/^\d+$/.test(String(record.amountAtomic ?? ""))) return null;
  if (typeof record.route !== "string" || !record.route.startsWith("/")) return null;
  if (typeof record.paymentClass !== "string" || record.paymentClass.length === 0) return null;
  if (typeof record.protocol !== "string" || record.protocol.length === 0) return null;
  if (!Number.isFinite(Date.parse(record.sourceEventTimestamp || ""))) return null;
  return {
    sourceEventId: record.sourceEventId,
    sourceEventTimestamp: record.sourceEventTimestamp,
    route: record.route,
    protocol: record.protocol,
    paymentClass: record.paymentClass,
    settlementReference: String(record.settlementReference).toLowerCase(),
    amountAtomic: String(record.amountAtomic),
    network: typeof record.network === "string" ? record.network : "",
    asset: typeof record.asset === "string" ? record.asset : "",
    treasury: typeof record.treasury === "string" ? record.treasury : "",
  };
}

function sameReference(left, right) {
  if (!left || !right) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function classifyValidationLine(row) {
  if (row?._unparseable) return { kind: "unparseable", record: null, paidEvidenceId: null };
  try {
    return { kind: "canonical", record: canonicalizeValidationRecord(row), paidEvidenceId: null };
  } catch {
    const paidEvidenceId = typeof row?.paidEvidenceId === "string" ? row.paidEvidenceId : null;
    return { kind: "rejected", record: null, paidEvidenceId };
  }
}

function classifyMcpLine(row) {
  if (row?._unparseable) return { kind: "unparseable", record: null, paidEvidenceId: null };
  try {
    return { kind: "canonical", record: canonicalizeMcpDeliveryRecord(row), paidEvidenceId: null };
  } catch {
    const paidEvidenceId = typeof row?.paidEvidenceId === "string" ? row.paidEvidenceId : null;
    return { kind: "rejected", record: null, paidEvidenceId };
  }
}

function eventCanonicalOf(paid, typed) {
  if (paid && typed) return "http_v1+mcp_typed_outcome";
  if (paid) return "http_v1";
  if (typed) return "mcp_typed_outcome";
  return null;
}

// MCP identity is the typed commerce event plus the delivery row.
// callDigest is recomputed from the call id. It is not compared to a copy of itself.
// responseDigest stays in the tool-text domain and is not an HTTP body digest.
function mcpMismatchReason(record, event, settlement) {
  if (!isCanonicalMcpTypedCommerceEvent(event)) return "typed_event_absent";
  if (record?.paidEvidenceId !== event.id || event.id !== settlement.sourceEventId) return "typed_event_mismatch";
  if (settlement.route !== "/mcp") return "foreign_route";
  if (settlement.protocol !== "x402") return "foreign_protocol";
  if (Date.parse(settlement.sourceEventTimestamp) !== Date.parse(event.ts)) return "foreign_event_time";
  const binding = event.binding;
  if (record.tool !== binding.tool || record.resource !== binding.resource) return "foreign_tool";
  if (record.tool !== MCP_MORPHO_TOOL || record.resource !== MCP_MORPHO_RESOURCE) return "foreign_tool";
  if (record.issuedOfferDigest !== binding.issuedOfferDigest) return "foreign_offer";
  if (record.settlementReference || settlement.settlementReference) {
    if (!sameReference(record.settlementReference, settlement.settlementReference)) return "foreign_reference";
  }
  if (typeof event.settlementAmountAtomic === "string") {
    if (String(settlement.amountAtomic) !== event.settlementAmountAtomic) return "amount_mismatch";
    if (String(settlement.network || "") !== String(event.settlementNetwork || "")) return "network_mismatch";
    if (String(settlement.asset || "").toLowerCase() !== String(event.settlementCurrency || "").toLowerCase()) return "asset_mismatch";
    if (String(settlement.treasury || "").toLowerCase() !== String(event.settlementPayee || "").toLowerCase()) return "payee_mismatch";
    if (!sameReference(event.settlementReference, settlement.settlementReference)) return "foreign_reference";
  }
  const callDigest = digestMcpCallId(record.callId);
  if (record.callDigest !== callDigest) return "foreign_call";
  const requestDigest = digestMcpDeliveryBinding({
    tool: binding.tool,
    callDigest,
    issuedOfferDigest: binding.issuedOfferDigest,
  });
  if (record.requestDigest !== requestDigest) return "foreign_call";
  if (!DIGEST_RE.test(record.responseDigest || "")) return "foreign_output";
  return null;
}

function mcpMatchesTyped(record, event, settlement) {
  return mcpMismatchReason(record, event, settlement) === null;
}

function sameCallerDeclaration(left, right) {
  return left?.source === right?.source
    && left?.disposition === right?.disposition
    && left?.paidEvidenceId === right?.paidEvidenceId
    && left?.requestDigest === right?.requestDigest
    && String(left?.settlementReference || "").toLowerCase() === String(right?.settlementReference || "").toLowerCase();
}

function mergeCallerDeclarations(feedbackDeclarations, callerDeclarations) {
  const merged = [];
  for (const item of [...(feedbackDeclarations || []), ...(callerDeclarations || [])]) {
    if (!item || typeof item !== "object") continue;
    if (merged.some((existing) => sameCallerDeclaration(existing, item))) continue;
    merged.push(item);
  }
  return merged;
}

function assessCaller(validation, paid, declaration) {
  if (!declaration) {
    return { callerAcceptance: "absent", callerDisposition: null, reason: "declaration_absent" };
  }
  if (declaration.inferred === true || !CALLER_SOURCES.has(declaration.source)) {
    return { callerAcceptance: "foreign", callerDisposition: null, reason: "declaration_source_rejected" };
  }
  const eventId = validation?.paidEvidenceId || paid?.id || null;
  const requestDigest = validation?.requestDigest || paid?.requestDigest || null;
  const settlementReference = validation?.settlementReference || paid?.settlementReference || null;
  const sameEvent = declaration.paidEvidenceId === eventId;
  const sameRequest = declaration.requestDigest === requestDigest && typeof requestDigest === "string";
  const sameSettlement = sameReference(declaration.settlementReference, settlementReference);
  if (!sameEvent || !sameRequest || !sameSettlement) {
    return { callerAcceptance: "foreign", callerDisposition: null, reason: "identity_mismatch" };
  }
  if (!validation) {
    return { callerAcceptance: "unknown", callerDisposition: null, reason: "validation_absent" };
  }
  const verdict = declareCallerUsefulness({ validation, declaration });
  if (verdict.present === true) {
    return {
      callerAcceptance: "bound",
      callerDisposition: verdict.disposition,
      reason: verdict.reason,
    };
  }
  return { callerAcceptance: "unknown", callerDisposition: null, reason: verdict.reason || "unknown" };
}

function blankRow(fields) {
  return {
    disposition: fields.disposition,
    reasons: fields.reasons,
    callerAcceptance: fields.callerAcceptance,
    callerDisposition: fields.callerDisposition ?? null,
    callerReason: fields.callerReason ?? null,
    callerSuppliedDisposition: fields.callerSuppliedDisposition ?? null,
    callerSuppliedReasonCategory: fields.callerSuppliedReasonCategory ?? null,
    usefulness: "unknown",
    individualJoin: fields.disposition === "exact_join",
    route: fields.route ?? null,
    method: fields.method ?? null,
    amountAtomic: fields.amountAtomic ?? null,
    paymentClass: fields.paymentClass ?? null,
    protocol: fields.protocol ?? null,
    sourceEventTimestamp: fields.sourceEventTimestamp ?? null,
    deliveryClass: fields.deliveryClass ?? null,
    validatorVerdict: fields.validatorVerdict ?? null,
    settlementReferencePresent: Boolean(fields.settlementReferencePresent),
    paidEvidencePresent: Boolean(fields.paidEvidencePresent),
    httpAttached: fields.httpAttached ?? 0,
    mcpAttached: fields.mcpAttached ?? 0,
    outcomeDelivery: fields.outcomeDelivery ?? "absent",
    taskRefBound: Boolean(fields.taskRefBound),
    eventCanonical: fields.eventCanonical ?? null,
    ...(fields.local ? { local: fields.local } : {}),
  };
}

function outcomeFor(paid, forwards) {
  const deliveries = forwards.filter((record) => record.commerceEventId === paid.id && record.stage === "delivery");
  if (deliveries.some((record) => record.receiptDigest !== paid.responseDigest)) {
    return { outcomeDelivery: "digest_conflict" };
  }
  if (deliveries.length === 0) return { outcomeDelivery: "absent" };
  const schemaValid = deliveries.every((record) => isSchemaValidDeliveryEvidence(record));
  return { outcomeDelivery: schemaValid ? "schema_valid" : "present_not_buyer_use" };
}

function uniqueDigests(records) {
  return new Set(records.map((record) => record.responseDigest)).size;
}

function deliveryDisposition({ httpRecords, mcpRecords, rejectedForId, outcome }) {
  const attached = [...httpRecords, ...mcpRecords];
  if (rejectedForId > 0 && attached.length === 0) {
    return { disposition: "rejected_schema", reasons: ["validation_schema_rejected"], deliveryClass: null, validatorVerdict: null };
  }
  if (attached.length === 0) {
    return { disposition: "missing_capture", reasons: ["capture_absent"], deliveryClass: null, validatorVerdict: null };
  }
  const reasons = [];
  if (uniqueDigests(httpRecords) > 1 || uniqueDigests(mcpRecords) > 1) reasons.push("capture_digest_conflict");
  const classes = new Set(attached.map((record) => record.deliveryClass));
  const verdicts = new Set(attached.map((record) => record.validatorVerdict));
  if (httpRecords.length > 0 && mcpRecords.length > 0) {
    reasons.push("capture_channel_conflict");
  }
  if (outcome.outcomeDelivery === "digest_conflict") reasons.push("outcome_digest_conflict");
  if (rejectedForId > 0) reasons.push("validation_schema_rejected");
  const deliveryClass = attached[0].deliveryClass;
  const validatorVerdict = attached[0].validatorVerdict;
  const bytesShort = attached.some((record) => record.retainedByteLength !== record.responseByteLength);
  if (reasons.length > 0) {
    return { disposition: "conflicting_join", reasons, deliveryClass, validatorVerdict };
  }
  if (deliveryClass === "truncated_partial" || bytesShort) {
    return { disposition: "incomplete_capture", reasons: ["truncated_or_partial_capture"], deliveryClass, validatorVerdict };
  }
  if (deliveryClass === "upstream_failed" || deliveryClass === "malformed_body" || validatorVerdict === "invalid") {
    return { disposition: "rejected_schema", reasons: ["output_schema_rejected"], deliveryClass, validatorVerdict };
  }
  if (validatorVerdict === "pass" && COMPLETE_CLASSES.has(deliveryClass)) {
    return { disposition: "exact_join", reasons: ["event_digest_route_reference"], deliveryClass, validatorVerdict };
  }
  return { disposition: "incomplete_capture", reasons: ["capture_not_complete"], deliveryClass, validatorVerdict };
}

export function joinOrdinaryDeliveries({
  settlements = [],
  paidEvidence = [],
  validations = [],
  rejectedValidations = [],
  typedEvents = [],
  mcpDeliveries = [],
  rejectedMcp = [],
  forwardRecords = [],
  taskRefs = [],
  callerDeclarations = [],
  feedbackDeclarations = [],
  windowStart,
  windowEnd,
  coverage = "unknown_for_full_window",
  sourceSha = null,
  includeLocalIds = false,
  rejectedLineCounts = [],
} = {}) {
  const startMs = Date.parse(windowStart || "");
  const endMs = Date.parse(windowEnd || "");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error("window start and end are required");
  }
  const paidById = new Map();
  const duplicatePaidIds = new Set();
  for (const row of paidEvidence) {
    if (!isHistoricalV1PaidSuccess(row)) continue;
    if (paidById.has(row.id)) duplicatePaidIds.add(row.id);
    else paidById.set(row.id, row);
  }
  const typedById = new Map();
  const duplicateTypedIds = new Set();
  for (const event of typedEvents) {
    if (!isCanonicalMcpTypedCommerceEvent(event)) continue;
    if (typedById.has(event.id)) duplicateTypedIds.add(event.id);
    else typedById.set(event.id, event);
  }
  const seenReferences = new Set();
  const rows = [];
  const declarations = mergeCallerDeclarations(feedbackDeclarations, callerDeclarations);
  const callerFor = (validation, paid, eventId) => {
    const matches = declarations.filter((item) => item?.paidEvidenceId === eventId);
    if (matches.length > 1) {
      return {
        callerAcceptance: "foreign",
        callerDisposition: null,
        reason: "multiple_declarations",
        suppliedDisposition: null,
        suppliedReasonCategory: null,
      };
    }
    if (matches.length === 0) return null;
    const assessed = assessCaller(validation, paid, matches[0]);
    const identityHeld = assessed.callerAcceptance === "bound"
      || assessed.reason === "historical_intent_not_retained"
      || assessed.reason === "validation_absent"
      || assessed.reason === "validation_usefulness_must_stay_unknown";
    const supplied = identityHeld && (matches[0].disposition === "useful" || matches[0].disposition === "not_useful")
      ? matches[0].disposition
      : null;
    return {
      ...assessed,
      suppliedDisposition: supplied,
      suppliedReasonCategory: supplied ? (matches[0].reasonCategory ?? null) : null,
    };
  };
  let withheldOutsideWindow = 0;
  const consumedIds = new Set();

  for (const settlement of settlements) {
    if (!inWindow(settlement.sourceEventTimestamp, startMs, endMs)) {
      withheldOutsideWindow += 1;
      continue;
    }
    const reference = settlement.settlementReference;
    if (seenReferences.has(reference)) {
      consumedIds.add(settlement.sourceEventId);
      rows.push(blankRow({
        disposition: "replayed_or_unknown_settlement",
        reasons: ["duplicate_settlement_reference"],
        callerAcceptance: "unknown",
        route: settlement.route,
        amountAtomic: settlement.amountAtomic,
        paymentClass: settlement.paymentClass,
        protocol: settlement.protocol,
        sourceEventTimestamp: settlement.sourceEventTimestamp,
        settlementReferencePresent: true,
        local: includeLocalIds ? {
          sourceEventId: settlement.sourceEventId,
          settlementReference: reference,
        } : null,
      }));
      continue;
    }
    seenReferences.add(reference);
    const paid = paidById.get(settlement.sourceEventId) || null;
    const typed = typedById.get(settlement.sourceEventId) || null;
    consumedIds.add(settlement.sourceEventId);
    const local = includeLocalIds ? {
      sourceEventId: settlement.sourceEventId,
      settlementReference: reference,
    } : null;
    const eventCanonical = eventCanonicalOf(
      paid && !duplicatePaidIds.has(settlement.sourceEventId) ? paid : null,
      typed && !duplicateTypedIds.has(settlement.sourceEventId) ? typed : null,
    );
    if (duplicatePaidIds.has(settlement.sourceEventId) || duplicateTypedIds.has(settlement.sourceEventId)) {
      rows.push(blankRow({
        disposition: "replayed_or_unknown_settlement",
        reasons: [duplicatePaidIds.has(settlement.sourceEventId) ? "duplicate_paid_evidence" : "duplicate_typed_event"],
        callerAcceptance: "unknown",
        route: settlement.route,
        amountAtomic: settlement.amountAtomic,
        paymentClass: settlement.paymentClass,
        protocol: settlement.protocol,
        sourceEventTimestamp: settlement.sourceEventTimestamp,
        settlementReferencePresent: true,
        paidEvidencePresent: Boolean(paid),
        eventCanonical,
        local,
      }));
      continue;
    }
    if (!paid && !typed) {
      rows.push(blankRow({
        disposition: "replayed_or_unknown_settlement",
        reasons: ["paid_evidence_absent"],
        callerAcceptance: "unknown",
        route: settlement.route,
        amountAtomic: settlement.amountAtomic,
        paymentClass: settlement.paymentClass,
        protocol: settlement.protocol,
        sourceEventTimestamp: settlement.sourceEventTimestamp,
        settlementReferencePresent: true,
        paidEvidencePresent: false,
        eventCanonical: null,
        local,
      }));
      continue;
    }
    if (typed && !TYPED_DELIVERY_RESULTS.has(typed.result)) {
      rows.push(blankRow({
        disposition: "replayed_or_unknown_settlement",
        reasons: ["typed_result_not_delivery"],
        callerAcceptance: "unknown",
        route: settlement.route,
        amountAtomic: settlement.amountAtomic,
        paymentClass: settlement.paymentClass,
        protocol: settlement.protocol,
        sourceEventTimestamp: settlement.sourceEventTimestamp,
        settlementReferencePresent: true,
        paidEvidencePresent: Boolean(paid),
        eventCanonical,
        local,
      }));
      continue;
    }
    if (
      paid && (
        !sameReference(paid.settlementReference, reference)
        || paid.route !== settlement.route
        || paid.paymentProtocol !== settlement.protocol
        || Date.parse(paid.responseFinishedAt) !== Date.parse(settlement.sourceEventTimestamp)
      )
    ) {
      rows.push(blankRow({
        disposition: "conflicting_join",
        reasons: ["settlement_does_not_match_paid_event"],
        callerAcceptance: "unknown",
        route: settlement.route,
        method: paid.method,
        amountAtomic: settlement.amountAtomic,
        paymentClass: settlement.paymentClass,
        protocol: settlement.protocol,
        sourceEventTimestamp: settlement.sourceEventTimestamp,
        settlementReferencePresent: true,
        paidEvidencePresent: true,
        eventCanonical,
        local,
      }));
      continue;
    }
    const named = paid ? validations.filter((record) => record.paidEvidenceId === paid.id) : [];
    const attached = named.filter((record) => validationAttachesToHistorical(record, paid));
    const borrowed = named.length - attached.length;
    const mcpNamed = typed ? mcpDeliveries.filter((record) => record.paidEvidenceId === typed.id) : [];
    const mcpAttachedRecords = mcpNamed.filter((record) => mcpMatchesTyped(record, typed, settlement));
    const rejectedForId = rejectedValidations.filter((item) => item.paidEvidenceId === settlement.sourceEventId).length
      + rejectedMcp.filter((item) => item.paidEvidenceId === settlement.sourceEventId).length;
    const outcome = paid ? outcomeFor(paid, forwardRecords) : { outcomeDelivery: "absent" };
    const taskMatches = taskRefs.filter((record) => record.commerceEventId === settlement.sourceEventId);
    let judged = deliveryDisposition({
      httpRecords: attached,
      mcpRecords: mcpAttachedRecords,
      rejectedForId,
      outcome,
    });
    if (borrowed > 0 || mcpNamed.length !== mcpAttachedRecords.length) {
      const reasons = [...judged.reasons];
      if (borrowed > 0) reasons.push("reference_cannot_borrow");
      for (const record of mcpNamed) {
        if (mcpAttachedRecords.includes(record)) continue;
        reasons.push(mcpMismatchReason(record, typed, settlement));
      }
      judged = {
        disposition: "conflicting_join",
        reasons,
        deliveryClass: judged.deliveryClass,
        validatorVerdict: judged.validatorVerdict,
      };
    }
    if (paid && typed) {
      judged = {
        ...judged,
        disposition: "conflicting_join",
        reasons: [...judged.reasons, "multiple_event_canons"],
      };
    }
    if (typed?.result === "paid_success" && typed.settlementState !== "succeeded" && judged.disposition === "exact_join") {
      judged = {
        ...judged,
        disposition: "conflicting_join",
        reasons: [...judged.reasons, "typed_result_mismatch"],
      };
    }
    if (typed && typed.result !== "paid_success" && typed.result !== "replay_success" && judged.disposition === "exact_join") {
      judged = {
        ...judged,
        disposition: "conflicting_join",
        reasons: [...judged.reasons, "typed_result_mismatch"],
      };
    }
    if (typed?.result === "replay_success") {
      judged = {
        disposition: "replayed_or_unknown_settlement",
        reasons: ["typed_replay"],
        deliveryClass: judged.deliveryClass,
        validatorVerdict: judged.validatorVerdict,
      };
    }
    if (taskMatches.length > 1) {
      judged = {
        ...judged,
        disposition: "conflicting_join",
        reasons: [...judged.reasons, "task_ref_conflict"],
      };
    }
    const callerSubject = attached[0] || mcpAttachedRecords[0] || null;
    const callerPaid = paid || (typed ? {
      id: typed.id,
      requestDigest: callerSubject?.requestDigest || null,
      settlementReference: settlement.settlementReference,
    } : null);
    const caller = callerFor(callerSubject, callerPaid, settlement.sourceEventId)
      || assessCaller(callerSubject, callerPaid, null);
    rows.push(blankRow({
      disposition: judged.disposition,
      reasons: [...new Set(judged.reasons)],
      callerAcceptance: caller.callerAcceptance,
      callerDisposition: caller.callerDisposition,
      callerReason: caller.reason,
      callerSuppliedDisposition: caller.suppliedDisposition ?? null,
      callerSuppliedReasonCategory: caller.suppliedReasonCategory ?? null,
      route: settlement.route,
      method: paid?.method || null,
      amountAtomic: settlement.amountAtomic,
      paymentClass: settlement.paymentClass,
      protocol: settlement.protocol,
      sourceEventTimestamp: settlement.sourceEventTimestamp,
      deliveryClass: judged.deliveryClass,
      validatorVerdict: judged.validatorVerdict,
      settlementReferencePresent: true,
      paidEvidencePresent: Boolean(paid),
      httpAttached: attached.length,
      mcpAttached: mcpAttachedRecords.length,
      outcomeDelivery: outcome.outcomeDelivery,
      taskRefBound: taskMatches.length === 1,
      eventCanonical,
      local,
    }));
  }

  for (const paid of paidById.values()) {
    if (consumedIds.has(paid.id)) continue;
    if (!inWindow(paid.responseFinishedAt, startMs, endMs)) continue;
    consumedIds.add(paid.id);
    const named = validations.filter((record) => record.paidEvidenceId === paid.id);
    const callerSubject = named.find((record) => (
      record.requestDigest === paid.requestDigest && record.responseDigest === paid.responseDigest
    )) || null;
    const caller = callerFor(callerSubject, paid, paid.id);
    rows.push(blankRow({
      disposition: "replayed_or_unknown_settlement",
      reasons: ["settlement_not_in_canonical_ledger"],
      callerAcceptance: caller?.callerAcceptance || "unknown",
      callerDisposition: caller?.callerDisposition || null,
      callerReason: caller?.reason || null,
      callerSuppliedDisposition: caller?.suppliedDisposition || null,
      callerSuppliedReasonCategory: caller?.suppliedReasonCategory || null,
      route: paid.route,
      method: paid.method,
      protocol: paid.paymentProtocol,
      sourceEventTimestamp: paid.responseFinishedAt,
      settlementReferencePresent: Boolean(paid.settlementReference),
      paidEvidencePresent: true,
      eventCanonical: "http_v1",
      local: includeLocalIds ? {
        sourceEventId: paid.id,
        settlementReference: paid.settlementReference ? String(paid.settlementReference).toLowerCase() : null,
      } : null,
    }));
  }

  for (const typed of typedById.values()) {
    if (consumedIds.has(typed.id) || duplicateTypedIds.has(typed.id)) continue;
    if (!TYPED_DELIVERY_RESULTS.has(typed.result)) continue;
    if (!inWindow(typed.ts, startMs, endMs)) continue;
    rows.push(blankRow({
      disposition: "replayed_or_unknown_settlement",
      reasons: ["settlement_not_in_canonical_ledger"],
      callerAcceptance: "unknown",
      route: "/mcp",
      protocol: "x402",
      sourceEventTimestamp: typed.ts,
      paidEvidencePresent: paidById.has(typed.id),
      eventCanonical: "mcp_typed_outcome",
      local: includeLocalIds ? {
        sourceEventId: typed.id,
        settlementReference: null,
      } : null,
    }));
  }

  rows.sort((left, right) => (
    String(left.sourceEventTimestamp).localeCompare(String(right.sourceEventTimestamp))
    || String(left.route).localeCompare(String(right.route))
    || String(left.amountAtomic).localeCompare(String(right.amountAtomic))
    || left.disposition.localeCompare(right.disposition)
  ));
  const counts = {
    exact_join: 0,
    conflicting_join: 0,
    missing_capture: 0,
    rejected_schema: 0,
    incomplete_capture: 0,
    replayed_or_unknown_settlement: 0,
  };
  for (const row of rows) {
    if (Object.hasOwn(counts, row.disposition)) counts[row.disposition] += 1;
  }
  const paymentEvidence = buildCommercePaymentEvidenceReadout({
    eventSnapshot: { requestedWindowCoverage: coverage },
    settlementReconciliation: null,
  });
  return {
    schema: REPORT_SCHEMA,
    producerBaseSha: PRODUCER_BASE_SHA,
    sourceSha,
    window: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      coverage,
      exhaustive: coverage === "complete",
    },
    aggregateRouteDeltaIsNotAnIndividualJoin: true,
    schemaValidityIsBuyerUsefulness: false,
    customerPlane: paymentEvidence.customerPlane,
    boundaries: paymentEvidence.boundaries,
    withheldOutsideWindow,
    rejectedLines: rejectedLineCounts,
    counts,
    rows,
    callerResultFeedback: callerFeedbackAggregate(rows),
  };
}

function callerFeedbackAggregate(rows) {
  let suppliedUseful = 0;
  let suppliedNotUseful = 0;
  let absent = 0;
  let unboundOrForeign = 0;
  let sealBoundUseful = 0;
  let sealBoundNotUseful = 0;
  for (const row of rows) {
    if (row.callerAcceptance === "bound" && row.callerDisposition === "useful") sealBoundUseful += 1;
    else if (row.callerAcceptance === "bound" && row.callerDisposition === "not_useful") sealBoundNotUseful += 1;
    if (row.callerSuppliedDisposition === "useful") suppliedUseful += 1;
    else if (row.callerSuppliedDisposition === "not_useful") suppliedNotUseful += 1;
    else if (row.callerAcceptance === "absent") absent += 1;
    else unboundOrForeign += 1;
  }
  return {
    schema: CALLER_FEEDBACK_AGGREGATE_SCHEMA,
    population: "rows_in_this_window",
    globalFunnel: false,
    customerCount: null,
    measuredUsefulness: "unknown",
    technicalValidationIsSeparate: true,
    settlementIsSeparate: true,
    sealBoundIsSeparate: true,
    suppliedUseful,
    suppliedNotUseful,
    absent,
    unboundOrForeign,
    sealBoundUseful,
    sealBoundNotUseful,
    boundary: "counts cover only rows in this report window; a missing statement is not inferred; usefulness stays unknown",
  };
}

export async function readOrdinaryDeliveryStores(dataDir) {
  if (typeof dataDir !== "string" || dataDir.length === 0) throw new Error("data directory is required");
  const info = await stat(dataDir);
  if (!info.isDirectory()) throw new Error("data directory is required");
  const [settlementText, paidText, commerceText, commerceRotated, validationText, mcpText, forwardText, forwardRotated, taskText, taskRotated, feedbackRead] = await Promise.all([
    readText(dataDir, FILE_CLASSES.settlementLedger),
    readText(dataDir, FILE_CLASSES.paidSuccessEvidence),
    readText(dataDir, FILE_CLASSES.commerceEvents),
    readText(dataDir, FILE_CLASSES.commerceEventsRotated),
    readText(dataDir, FILE_CLASSES.httpValidation),
    readText(dataDir, FILE_CLASSES.mcpDelivery),
    readText(dataDir, FILE_CLASSES.outcomeBinding),
    readText(dataDir, FILE_CLASSES.outcomeBindingRotated),
    readText(dataDir, FILE_CLASSES.taskRef),
    readText(dataDir, FILE_CLASSES.taskRefRotated),
    createCallerResultFeedbackService({ dataDir }).readDeclarations(),
  ]);
  const rejectedLineCounts = [];
  const note = (file, count) => {
    if (count > 0) rejectedLineCounts.push({ file, count });
  };
  const settlements = [];
  let badSettlements = 0;
  for (const row of parseNdjson(settlementText)) {
    const canonical = row?._unparseable ? null : canonicalSettlement(row);
    if (canonical) settlements.push(canonical);
    else badSettlements += 1;
  }
  note(FILE_CLASSES.settlementLedger, badSettlements);
  const paidEvidence = [];
  let badPaid = 0;
  for (const row of parseNdjson(paidText)) {
    if (isHistoricalV1PaidSuccess(row)) paidEvidence.push(row);
    else badPaid += 1;
  }
  note(FILE_CLASSES.paidSuccessEvidence, badPaid);
  const typedEvents = [];
  let badTyped = 0;
  for (const row of parseNdjson(`${commerceText}\n${commerceRotated}`)) {
    if (row?._unparseable) {
      badTyped += 1;
      continue;
    }
    if (isCanonicalMcpTypedCommerceEvent(row)) {
      typedEvents.push(row);
      continue;
    }
    if (row?.sourceContract === "mcp_typed_outcome") badTyped += 1;
  }
  note(FILE_CLASSES.commerceEvents, badTyped);
  const validations = [];
  const rejectedValidations = [];
  let badValidation = 0;
  for (const row of parseNdjson(validationText)) {
    const classified = classifyValidationLine(row);
    if (classified.kind === "canonical") validations.push(classified.record);
    else {
      badValidation += 1;
      if (classified.paidEvidenceId) rejectedValidations.push(classified);
    }
  }
  note(FILE_CLASSES.httpValidation, badValidation);
  const mcpDeliveries = [];
  const rejectedMcp = [];
  let badMcp = 0;
  for (const row of parseNdjson(mcpText)) {
    const classified = classifyMcpLine(row);
    if (classified.kind === "canonical") mcpDeliveries.push(classified.record);
    else {
      badMcp += 1;
      if (classified.paidEvidenceId) rejectedMcp.push(classified);
    }
  }
  note(FILE_CLASSES.mcpDelivery, badMcp);
  const forwardRecords = [];
  let badForward = 0;
  for (const row of parseNdjson(`${forwardText}\n${forwardRotated}`)) {
    if (isForwardV2Record(row)) forwardRecords.push(row);
    else badForward += 1;
  }
  note(FILE_CLASSES.outcomeBinding, badForward);
  const taskRefs = [];
  let badTask = 0;
  for (const row of parseNdjson(`${taskText}\n${taskRotated}`)) {
    if (isTaskRefRecord(row)) taskRefs.push(row);
    else badTask += 1;
  }
  note(FILE_CLASSES.taskRef, badTask);
  note(FILE_CLASSES.callerResultFeedback, feedbackRead.rejected);
  return {
    settlements,
    paidEvidence,
    typedEvents,
    validations,
    rejectedValidations,
    mcpDeliveries,
    rejectedMcp,
    forwardRecords,
    taskRefs,
    feedbackDeclarations: feedbackRead.declarations,
    rejectedLineCounts,
  };
}

export async function receiveOrdinaryDeliveryJoin(options) {
  const stores = await readOrdinaryDeliveryStores(options.dataDir);
  return joinOrdinaryDeliveries({ ...stores, ...options });
}

export function reportViolations(report) {
  const found = [];
  const bad = (code) => {
    if (!found.includes(code)) found.push(code);
  };
  if (!report || report.schema !== REPORT_SCHEMA) return ["schema"];
  if (report.aggregateRouteDeltaIsNotAnIndividualJoin !== true) bad("aggregate_join_claimed");
  if (report.schemaValidityIsBuyerUsefulness !== false) bad("schema_called_useful");
  const plane = report.customerPlane || {};
  if (plane.attributableCustomerCount !== null || plane.buyerValidDeliveryCount !== null || plane.repeatIndependentCustomerCount !== null) {
    bad("customer_plane_filled");
  }
  if (report.boundaries?.settlementNeverProvesBuyerValidDelivery !== true) bad("settlement_proves_delivery");
  const feedback = report.callerResultFeedback;
  if (
    !feedback
    || feedback.schema !== CALLER_FEEDBACK_AGGREGATE_SCHEMA
    || feedback.population !== "rows_in_this_window"
    || feedback.globalFunnel !== false
    || feedback.customerCount !== null
    || feedback.measuredUsefulness !== "unknown"
    || feedback.technicalValidationIsSeparate !== true
    || feedback.settlementIsSeparate !== true
    || feedback.sealBoundIsSeparate !== true
  ) {
    bad("caller_feedback_overclaimed");
  }
  let suppliedUseful = 0;
  let suppliedNotUseful = 0;
  let absent = 0;
  let unboundOrForeign = 0;
  for (const row of report.rows || []) {
    if (row.callerSuppliedDisposition === "useful") suppliedUseful += 1;
    else if (row.callerSuppliedDisposition === "not_useful") suppliedNotUseful += 1;
    else if (row.callerAcceptance === "absent") absent += 1;
    else unboundOrForeign += 1;
  }
  const covered = suppliedUseful + suppliedNotUseful + absent + unboundOrForeign;
  if (
    !feedback
    || feedback.suppliedUseful !== suppliedUseful
    || feedback.suppliedNotUseful !== suppliedNotUseful
    || feedback.absent !== absent
    || feedback.unboundOrForeign !== unboundOrForeign
    || covered !== (report.rows || []).length
    || feedback.suppliedUseful + feedback.suppliedNotUseful < (feedback.sealBoundUseful || 0) + (feedback.sealBoundNotUseful || 0)
  ) {
    bad("caller_feedback_coverage");
  }
  for (const row of report.rows || []) {
    if (row.usefulness !== "unknown") bad("usefulness_filled");
    if (row.disposition === "exact_join" && row.httpAttached + row.mcpAttached < 1) bad("exact_join_without_capture");
    if (row.individualJoin === true && row.disposition !== "exact_join") bad("individual_join_without_exact_capture");
    if (row.disposition === "exact_join" && row.individualJoin !== true) bad("exact_join_unmarked");
    const serialized = JSON.stringify(row);
    if (serialized.includes("requestedUrl") || serialized.includes("payment-signature") || serialized.includes("BEGIN PRIVATE KEY")) {
      bad("sensitive_field_exported");
    }
  }
  return found;
}