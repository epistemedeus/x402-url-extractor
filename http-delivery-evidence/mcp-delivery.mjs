import { randomUUID } from "node:crypto";

import { MORPHO_POSITION_CONTRACT, MAX_RESPONSE_BYTES } from "./contract.mjs";
import {
  MCP_TOOL_VALIDATOR_SOURCE,
  PROHIBITED_INFERENCES,
  SETTLEMENT_CLASS,
  USEFULNESS_UNKNOWN,
  VALIDATOR_AUTHORITY,
  evaluateMcpToolDelivery,
} from "./classify.mjs";
import { digestMcpCallId, digestMcpDeliveryBinding, digestMcpPayload } from "./digest.mjs";
import { PAID_EVIDENCE_ID_PATTERN } from "./historical.mjs";
import {
  attachRecordObservation,
  bindDeliveryObservation,
  createDeliveryObservation,
  isSealedDeliveryObservation,
  observationPayload,
} from "./observation.mjs";

export const MCP_DELIVERY_FILENAME = "mcp-tool-delivery.v1.ndjson";
export const MCP_DELIVERY_SCHEMA = "samedaydesk.mcp-tool-delivery.v1";
export const MCP_MORPHO_RESOURCE = "mcp://tool/morpho_position";
export const MCP_MORPHO_TOOL = "morpho_position";

export const MCP_DELIVERY_KEYS = Object.freeze([
  "applicationIsError",
  "callDigest",
  "callId",
  "capturedAt",
  "contractName",
  "counters",
  "deliveryClass",
  "issuedOfferDigest",
  "paidEvidenceId",
  "payerClass",
  "productSku",
  "prohibitedInferences",
  "recordId",
  "requestDigest",
  "resource",
  "responseByteLength",
  "responseDigest",
  "retainedByteLength",
  "schemaVersion",
  "settlementClass",
  "settlementReference",
  "settlementState",
  "tool",
  "transport",
  "usefulness",
  "validatorAuthority",
  "validatorSource",
  "validatorVerdict",
]);

const RECORD_ID_RE = /^mtd_[0-9a-f]{32}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const CALL_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SKU_RE = /^[a-z][a-z0-9-]{0,95}$/;
const VERDICTS = new Set(["pass", "invalid", "unknown"]);
const SETTLEMENTS = new Set(Object.values(SETTLEMENT_CLASS));
const SETTLEMENT_STATES = new Set(["failed", "not_attempted", "succeeded", "unknown"]);
const FORBIDDEN_SUBSTRINGS = [
  "payment-signature",
  "PAYMENT-SIGNATURE",
  "wallet_private",
  "BEGIN PRIVATE KEY",
  "?url=",
  "raw-query",
];

function safeCallId(id) {
  if (typeof id === "number" && Number.isSafeInteger(id) && CALL_ID_RE.test(String(id))) return String(id);
  if (typeof id === "string" && CALL_ID_RE.test(id)) return id;
  return null;
}

function payloadBytesFromToolResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return Buffer.alloc(0);
  const text = result.content?.[0]?.text;
  if (typeof text === "string") return Buffer.from(text, "utf8");
  if (result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)) {
    try {
      return Buffer.from(JSON.stringify(result.structuredContent), "utf8");
    } catch {
      return Buffer.alloc(0);
    }
  }
  return Buffer.alloc(0);
}

/**
 * Seal the bytes observed on the MCP transport. The digest is computed here,
 * at the observation site. A later recorder cannot substitute its own digest.
 */
export function sealObservedMcpToolResult({
  tool,
  productSku,
  resource,
  issuedOfferDigest,
  callId,
  result,
  settlementReference = null,
} = {}) {
  if (tool !== MCP_MORPHO_TOOL || resource !== MCP_MORPHO_RESOURCE) return null;
  if (typeof issuedOfferDigest !== "string" || !DIGEST_RE.test(issuedOfferDigest)) return null;
  if (typeof productSku !== "string" || !SKU_RE.test(productSku)) return null;
  const bytes = payloadBytesFromToolResult(result);
  const retained = bytes.length > MAX_RESPONSE_BYTES ? bytes.subarray(0, MAX_RESPONSE_BYTES) : bytes;
  const reference = typeof settlementReference === "string" && TX_RE.test(settlementReference)
    ? settlementReference.toLowerCase()
    : null;
  return createDeliveryObservation({
    source: "mcp_tool_result",
    responseDigest: digestMcpPayload(bytes),
    responseByteLength: bytes.length,
    tool,
    productSku,
    resource,
    issuedOfferDigest,
    callId: safeCallId(callId),
    callDigest: digestMcpCallId(callId),
    settlementReference: reference,
    applicationIsError: result?.isError === true,
    payload: retained,
  });
}

function absent() {
  return null;
}

/**
 * Build the private MCP delivery row from a seal created at the transport hook.
 * Returns null for every tool other than morpho_position. This is not an HTTP GET.
 */
export function recordFromObservedMcpDelivery({
  observation,
  settlementState,
  paidEvidenceId,
  settlementClass,
  capturedAt,
  recordId,
} = {}) {
  if (!isSealedDeliveryObservation(observation)) return absent();
  if (observation.source !== "mcp_tool_result" || observation.tool !== MCP_MORPHO_TOOL) return absent();
  if (observation.resource !== MCP_MORPHO_RESOURCE) return absent();
  const bound = bindDeliveryObservation(observation, { paidEvidenceId });
  if (!bound) return absent();
  const payload = observationPayload(bound) || Buffer.alloc(0);
  const actualLength = bound.responseByteLength;
  if (!Number.isInteger(actualLength) || actualLength < payload.length) return absent();
  if (actualLength === payload.length) {
    if (bound.responseDigest !== digestMcpPayload(payload)) return absent();
  } else if (payload.length !== Math.min(actualLength, MAX_RESPONSE_BYTES)) {
    return absent();
  }
  const toolResult = {
    content: payload.length ? [{ type: "text", text: payload.toString("utf8") }] : [],
    isError: bound.applicationIsError === true,
  };
  const evaluated = evaluateMcpToolDelivery({
    toolName: MCP_MORPHO_TOOL,
    toolResult,
    settlementClass,
    settlementReference: bound.settlementReference,
    responseByteLength: actualLength,
    capturedAt,
    recordId,
  });
  const canonical = canonicalizeMcpDeliveryRecord({
    schemaVersion: MCP_DELIVERY_SCHEMA,
    recordId: recordId || `mtd_${randomUUID().replaceAll("-", "")}`,
    capturedAt: capturedAt || new Date().toISOString(),
    transport: "mcp",
    tool: MCP_MORPHO_TOOL,
    productSku: bound.productSku,
    resource: MCP_MORPHO_RESOURCE,
    paidEvidenceId,
    callId: bound.callId,
    callDigest: bound.callDigest,
    requestDigest: digestMcpDeliveryBinding({
      tool: MCP_MORPHO_TOOL,
      callDigest: bound.callDigest,
      issuedOfferDigest: bound.issuedOfferDigest,
    }),
    issuedOfferDigest: bound.issuedOfferDigest,
    contractName: MORPHO_POSITION_CONTRACT,
    responseDigest: bound.responseDigest,
    responseByteLength: actualLength,
    retainedByteLength: payload.length,
    applicationIsError: bound.applicationIsError === true,
    settlementClass,
    settlementReference: bound.settlementReference,
    settlementState,
    payerClass: "unclassified",
    validatorVerdict: evaluated.validatorVerdict,
    validatorAuthority: VALIDATOR_AUTHORITY,
    validatorSource: MCP_TOOL_VALIDATOR_SOURCE,
    deliveryClass: evaluated.deliveryClass,
    usefulness: USEFULNESS_UNKNOWN,
    counters: evaluated.counters,
    prohibitedInferences: [...PROHIBITED_INFERENCES],
  });
  return attachRecordObservation(canonical, bound);
}

export function canonicalizeMcpDeliveryRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("mcp delivery record must be a plain object");
  }
  const canonical = {
    schemaVersion: value.schemaVersion,
    recordId: value.recordId,
    capturedAt: value.capturedAt,
    transport: value.transport,
    tool: value.tool,
    productSku: value.productSku,
    resource: value.resource,
    paidEvidenceId: value.paidEvidenceId,
    callId: value.callId ?? null,
    callDigest: value.callDigest,
    requestDigest: value.requestDigest,
    issuedOfferDigest: value.issuedOfferDigest,
    contractName: value.contractName,
    responseDigest: value.responseDigest,
    responseByteLength: value.responseByteLength,
    retainedByteLength: value.retainedByteLength,
    applicationIsError: value.applicationIsError === true,
    settlementClass: value.settlementClass,
    settlementReference: value.settlementReference ?? null,
    settlementState: value.settlementState,
    payerClass: value.payerClass,
    validatorVerdict: value.validatorVerdict,
    validatorAuthority: value.validatorAuthority,
    validatorSource: value.validatorSource,
    deliveryClass: value.deliveryClass,
    usefulness: value.usefulness,
    counters: {
      schemaErrors: counterOrDefault(value.counters?.schemaErrors),
      requiredPresent: counterOrDefault(value.counters?.requiredPresent),
      truncateMarks: counterOrDefault(value.counters?.truncateMarks),
      sourceRefusalMarks: counterOrDefault(value.counters?.sourceRefusalMarks),
    },
    prohibitedInferences: Array.isArray(value.prohibitedInferences)
      ? [...value.prohibitedInferences]
      : [...PROHIBITED_INFERENCES],
  };
  assertMcpDeliveryRecord(canonical);
  return canonical;
}

export function assertMcpDeliveryRecord(value) {
  const keys = Object.keys(value).sort();
  if (keys.length !== MCP_DELIVERY_KEYS.length || keys.some((key, index) => key !== MCP_DELIVERY_KEYS[index])) {
    throw new Error("mcp delivery record has unexpected keys");
  }
  if (value.schemaVersion !== MCP_DELIVERY_SCHEMA) throw new Error("unsupported mcp delivery schema");
  if (!RECORD_ID_RE.test(value.recordId)) throw new Error("invalid recordId");
  if (!ISO_RE.test(value.capturedAt)) throw new Error("invalid capturedAt");
  if (value.transport !== "mcp") throw new Error("invalid transport");
  if (value.tool !== MCP_MORPHO_TOOL) throw new Error("invalid tool");
  if (typeof value.productSku !== "string" || !SKU_RE.test(value.productSku)) throw new Error("invalid productSku");
  if (value.resource !== MCP_MORPHO_RESOURCE) throw new Error("invalid resource");
  if (!PAID_EVIDENCE_ID_PATTERN.test(value.paidEvidenceId)) throw new Error("invalid paidEvidenceId");
  if (value.callId !== null && !CALL_ID_RE.test(value.callId)) throw new Error("invalid callId");
  if (!DIGEST_RE.test(value.callDigest)) throw new Error("invalid callDigest");
  if (!DIGEST_RE.test(value.requestDigest)) throw new Error("invalid requestDigest");
  if (!DIGEST_RE.test(value.issuedOfferDigest)) throw new Error("invalid issuedOfferDigest");
  if (value.contractName !== MORPHO_POSITION_CONTRACT) throw new Error("invalid contractName");
  if (!DIGEST_RE.test(value.responseDigest)) throw new Error("invalid responseDigest");
  requireFiniteInteger(value.responseByteLength, "responseByteLength", 0, Number.MAX_SAFE_INTEGER);
  requireFiniteInteger(value.retainedByteLength, "retainedByteLength", 0, MAX_RESPONSE_BYTES);
  if (value.retainedByteLength > value.responseByteLength) {
    throw new Error("retainedByteLength cannot exceed responseByteLength");
  }
  if (typeof value.applicationIsError !== "boolean") throw new Error("invalid applicationIsError");
  if (!SETTLEMENTS.has(value.settlementClass)) throw new Error("invalid settlementClass");
  if (value.settlementReference !== null && !TX_RE.test(value.settlementReference)) {
    throw new Error("invalid settlementReference");
  }
  if (!SETTLEMENT_STATES.has(value.settlementState)) throw new Error("invalid settlementState");
  if (value.payerClass !== "unclassified") throw new Error("invalid payerClass");
  if (!VERDICTS.has(value.validatorVerdict)) throw new Error("invalid validatorVerdict");
  if (value.validatorAuthority !== VALIDATOR_AUTHORITY) throw new Error("invalid validatorAuthority");
  if (value.validatorSource !== MCP_TOOL_VALIDATOR_SOURCE) throw new Error("invalid validatorSource");
  if (typeof value.deliveryClass !== "string" || value.deliveryClass.length === 0) {
    throw new Error("invalid deliveryClass");
  }
  if (value.usefulness !== USEFULNESS_UNKNOWN) throw new Error("usefulness must remain unknown");
  const counterKeys = Object.keys(value.counters).sort();
  const expectedCounters = ["requiredPresent", "schemaErrors", "sourceRefusalMarks", "truncateMarks"];
  if (counterKeys.length !== expectedCounters.length || counterKeys.some((key, index) => key !== expectedCounters[index])) {
    throw new Error("mcp delivery counters have unexpected keys");
  }
  for (const name of expectedCounters) {
    requireFiniteInteger(value.counters[name], `counter ${name}`, 0, 99);
  }
  if (!Array.isArray(value.prohibitedInferences) || value.prohibitedInferences.length < 4) {
    throw new Error("prohibitedInferences required");
  }
  const serialized = JSON.stringify(value);
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (serialized.includes(needle)) throw new Error("mcp delivery record retained a forbidden secret class");
  }
}

export function mcpDeliveryAttaches(record, claim) {
  if (!record || !claim) return false;
  if (record.tool !== MCP_MORPHO_TOOL || claim.tool !== MCP_MORPHO_TOOL) return false;
  if (record.paidEvidenceId !== claim.paidEvidenceId) return false;
  if (record.callDigest !== claim.callDigest) return false;
  if (record.responseDigest !== claim.responseDigest) return false;
  if (record.resource !== claim.resource || claim.resource !== MCP_MORPHO_RESOURCE) return false;
  const recordSettlement = record.settlementReference || null;
  const claimSettlement = claim.settlementReference || null;
  if (recordSettlement || claimSettlement) {
    if (!recordSettlement || !claimSettlement) return false;
    if (String(recordSettlement).toLowerCase() !== String(claimSettlement).toLowerCase()) return false;
  }
  if (claim.issuedOfferDigest && record.issuedOfferDigest !== claim.issuedOfferDigest) return false;
  return true;
}

function counterOrDefault(value) {
  if (value === undefined) return 0;
  requireFiniteInteger(value, "counter", 0, 99);
  return value;
}

function requireFiniteInteger(value, label, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`invalid ${label}`);
  }
  if (value < min || value > max) throw new Error(`invalid ${label}`);
  return value;
}
