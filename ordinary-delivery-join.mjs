// Read-only join of one canonical settlement to its captured delivery.
// Identity is paidEvidenceId plus digest, route, and settlement reference.
// Aggregate route counts are not a join. Schema validity is not buyer usefulness.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

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
  mcpDeliveryAttaches,
} from "./http-delivery-evidence/mcp-delivery.mjs";
import {
  VALIDATION_FILENAME,
  canonicalizeValidationRecord,
  validationAttachesToHistorical,
} from "./http-delivery-evidence/store.mjs";

export const PRODUCER_BASE_SHA = "cbfed005c5200f76feb419ebb3a4ce8ffee49644";
export const REPORT_SCHEMA = "samedaydesk.ordinary-delivery-join.v1";
export const SETTLEMENT_LEDGER_FILENAME = "commerce-settlements.ndjson";

export const FILE_CLASSES = Object.freeze({
  settlementLedger: SETTLEMENT_LEDGER_FILENAME,
  paidSuccessEvidence: PAID_EVIDENCE_FILENAME,
  httpValidation: VALIDATION_FILENAME,
  mcpDelivery: MCP_DELIVERY_FILENAME,
  outcomeBinding: FORWARD_BINDING_FILENAME,
  outcomeBindingRotated: FORWARD_BINDING_ROTATED_FILENAME,
  taskRef: TASK_REF_FILENAME,
  taskRefRotated: TASK_REF_ROTATED_FILENAME,
});

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

function mcpAttachesToPaid(record, paid) {
  if (!record || record.paidEvidenceId !== paid.id) return false;
  if (record.tool !== MCP_MORPHO_TOOL || record.resource !== MCP_MORPHO_RESOURCE) return false;
  if (record.settlementReference || paid.settlementReference) {
    if (!sameReference(record.settlementReference, paid.settlementReference)) return false;
  }
  return mcpDeliveryAttaches(record, {
    tool: MCP_MORPHO_TOOL,
    paidEvidenceId: paid.id,
    callDigest: record.callDigest,
    responseDigest: record.responseDigest,
    resource: MCP_MORPHO_RESOURCE,
    settlementReference: paid.settlementReference,
  });
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
  if ((httpRecords.length > 0 && mcpRecords.length > 0) && (classes.size > 1 || verdicts.size > 1)) {
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
  mcpDeliveries = [],
  rejectedMcp = [],
  forwardRecords = [],
  taskRefs = [],
  callerDeclarations = [],
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
  const seenReferences = new Set();
  const rows = [];
  let withheldOutsideWindow = 0;
  const consumedPaid = new Set();

  for (const settlement of settlements) {
    if (!inWindow(settlement.sourceEventTimestamp, startMs, endMs)) {
      withheldOutsideWindow += 1;
      continue;
    }
    const reference = settlement.settlementReference;
    if (seenReferences.has(reference)) {
      consumedPaid.add(settlement.sourceEventId);
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
    if (paid) consumedPaid.add(paid.id);
    const local = includeLocalIds ? {
      sourceEventId: settlement.sourceEventId,
      settlementReference: reference,
    } : null;
    if (!paid || duplicatePaidIds.has(settlement.sourceEventId)) {
      rows.push(blankRow({
        disposition: "replayed_or_unknown_settlement",
        reasons: [paid ? "duplicate_paid_evidence" : "paid_evidence_absent"],
        callerAcceptance: "unknown",
        route: settlement.route,
        amountAtomic: settlement.amountAtomic,
        paymentClass: settlement.paymentClass,
        protocol: settlement.protocol,
        sourceEventTimestamp: settlement.sourceEventTimestamp,
        settlementReferencePresent: true,
        paidEvidencePresent: Boolean(paid),
        local,
      }));
      continue;
    }
    if (
      !sameReference(paid.settlementReference, reference)
      || paid.route !== settlement.route
      || paid.paymentProtocol !== settlement.protocol
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
        local,
      }));
      continue;
    }
    const named = validations.filter((record) => record.paidEvidenceId === paid.id);
    const attached = named.filter((record) => validationAttachesToHistorical(record, paid));
    const borrowed = named.length - attached.length;
    const mcpNamed = mcpDeliveries.filter((record) => record.paidEvidenceId === paid.id);
    const mcpAttachedRecords = mcpNamed.filter((record) => mcpAttachesToPaid(record, paid));
    const rejectedForId = rejectedValidations.filter((item) => item.paidEvidenceId === paid.id).length
      + rejectedMcp.filter((item) => item.paidEvidenceId === paid.id).length;
    const outcome = outcomeFor(paid, forwardRecords);
    const taskMatches = taskRefs.filter((record) => record.commerceEventId === paid.id);
    let judged = deliveryDisposition({
      httpRecords: attached,
      mcpRecords: mcpAttachedRecords,
      rejectedForId,
      outcome,
    });
    if (borrowed > 0 || mcpNamed.length !== mcpAttachedRecords.length) {
      judged = {
        disposition: "conflicting_join",
        reasons: [...judged.reasons, "reference_cannot_borrow"],
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
    const caller = assessCaller(attached[0] || mcpAttachedRecords[0] || null, paid, callerDeclarations.find((item) => item?.paidEvidenceId === paid.id) || null);
    if (callerDeclarations.filter((item) => item?.paidEvidenceId === paid.id).length > 1) {
      caller.callerAcceptance = "foreign";
      caller.callerDisposition = null;
      caller.reason = "multiple_declarations";
    }
    rows.push(blankRow({
      disposition: judged.disposition,
      reasons: [...new Set(judged.reasons)],
      callerAcceptance: caller.callerAcceptance,
      callerDisposition: caller.callerDisposition,
      callerReason: caller.reason,
      route: settlement.route,
      method: paid.method,
      amountAtomic: settlement.amountAtomic,
      paymentClass: settlement.paymentClass,
      protocol: settlement.protocol,
      sourceEventTimestamp: settlement.sourceEventTimestamp,
      deliveryClass: judged.deliveryClass,
      validatorVerdict: judged.validatorVerdict,
      settlementReferencePresent: true,
      paidEvidencePresent: true,
      httpAttached: attached.length,
      mcpAttached: mcpAttachedRecords.length,
      outcomeDelivery: outcome.outcomeDelivery,
      taskRefBound: taskMatches.length === 1,
      local,
    }));
  }

  for (const paid of paidById.values()) {
    if (consumedPaid.has(paid.id)) continue;
    if (!inWindow(paid.responseFinishedAt, startMs, endMs)) continue;
    rows.push(blankRow({
      disposition: "replayed_or_unknown_settlement",
      reasons: ["settlement_not_in_canonical_ledger"],
      callerAcceptance: "unknown",
      route: paid.route,
      method: paid.method,
      protocol: paid.paymentProtocol,
      sourceEventTimestamp: paid.responseFinishedAt,
      settlementReferencePresent: Boolean(paid.settlementReference),
      paidEvidencePresent: true,
      local: includeLocalIds ? {
        sourceEventId: paid.id,
        settlementReference: paid.settlementReference ? String(paid.settlementReference).toLowerCase() : null,
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
  };
}

export async function readOrdinaryDeliveryStores(dataDir) {
  if (typeof dataDir !== "string" || dataDir.length === 0) throw new Error("data directory is required");
  const info = await stat(dataDir);
  if (!info.isDirectory()) throw new Error("data directory is required");
  const [settlementText, paidText, validationText, mcpText, forwardText, forwardRotated, taskText, taskRotated] = await Promise.all([
    readText(dataDir, FILE_CLASSES.settlementLedger),
    readText(dataDir, FILE_CLASSES.paidSuccessEvidence),
    readText(dataDir, FILE_CLASSES.httpValidation),
    readText(dataDir, FILE_CLASSES.mcpDelivery),
    readText(dataDir, FILE_CLASSES.outcomeBinding),
    readText(dataDir, FILE_CLASSES.outcomeBindingRotated),
    readText(dataDir, FILE_CLASSES.taskRef),
    readText(dataDir, FILE_CLASSES.taskRefRotated),
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
  return {
    settlements,
    paidEvidence,
    validations,
    rejectedValidations,
    mcpDeliveries,
    rejectedMcp,
    forwardRecords,
    taskRefs,
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
