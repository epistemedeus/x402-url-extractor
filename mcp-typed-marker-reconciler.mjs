import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Offline operator tool: reconcile one typed MCP release-canary marker against
// a bounded JSONL ledger of canonical v4 `mcp_typed_outcome` rows.
//
// Provider-neutral at the evidence boundary: plain JSONL in, plain JSON out,
// no network, no filesystem writes, no runtime dependencies. The digest and
// row contract mirror commerce-events.mjs exactly (that module cannot be
// imported here because it pulls the `mppx` runtime dependency).

export const MCP_TYPED_MARKER_RECONCILIATION_SCHEMA = "samedaydesk.mcp-typed-marker-reconciliation.v1";
const ATTRIBUTION_SCHEMA = "samedaydesk.mcp-request-attribution.v1";
const MARKER_DOMAIN = "samedaydesk.mcp-request-attribution-marker.v1\0";
const MARKER_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/u;
const SOURCE_CONTRACT = "mcp_typed_outcome";
const AUTHORITY = "seller_declared";
const EVIDENCE_CLASS = "seller_operational";
const HEX_256 = /^[0-9a-f]{64}$/u;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const SKU_PATTERN = /^[a-z][a-z0-9-]{0,95}$/u;

const ATTRIBUTION_KEYS = Object.freeze([
  "classification",
  "evidence",
  "markerDigest",
  "schemaVersion",
]);
const TYPED_COMMERCE_KEYS = Object.freeze([
  "accounting",
  "action",
  "applicationOutcome",
  "authority",
  "binding",
  "chainTruth",
  "demand",
  "evidenceClass",
  "handlerInvoked",
  "id",
  "independentUse",
  "payerIdentity",
  "paymentCredentialParsed",
  "paymentPresent",
  "reason",
  "result",
  "revenue",
  "settlementState",
  "sourceContract",
  "ts",
  "v",
]);
const ATTRIBUTED_COMMERCE_KEYS = Object.freeze([...TYPED_COMMERCE_KEYS, "requestAttribution"]);

const CLOSED_TOOLS = Object.freeze(new Set([
  "agent_discoverability_audit",
  "agent_surface_budget_audit",
  "contract_qualified_search",
  "deep_audit",
  "enrich",
  "extract",
  "morpho_market_underwrite",
  "morpho_position",
  "morpho_preliquidation_replay",
  "morpho_protection",
  "opportunity_preflight",
  "payment_offer_preflight",
  "read",
  "scan",
  "schemaforge",
  "seller_integrity_audit",
  "settlement_proof",
  "solana_transaction_receipt",
  "stateful_wallet_policy_conformance",
  "transaction_receipt",
  "wallet_enrich",
  "wallet_policy_conformance",
]));
const ACTIONS = new Set(["drop", "emit"]);
const RESULTS = new Set([
  "application_failure",
  "challenge",
  "invalid",
  "paid_success",
  "protocol_discovery",
  "replay_success",
  "settlement_failure",
  "telemetry_incomplete",
]);
const REASONS = new Set([
  "invalid_catalog_binding",
  "invalid_notification_state",
  "invalid_typed_outcome",
  "issued_offer_binding_mismatch",
  "jsonrpc_notification",
  "request_response_id_mismatch",
  "settlement_outcome_unknown",
  "typed_application_failure",
  "typed_paid_success",
  "typed_payment_required",
  "typed_replay_success",
  "typed_settlement_failure",
  "verified_without_execution",
]);
const APPLICATION_OUTCOMES = new Set(["error", "not_run", "replay", "success"]);
const SETTLEMENT_STATES = new Set(["failed", "not_attempted", "succeeded", "unknown"]);
const DROP_REASONS = new Set([
  "invalid_catalog_binding",
  "invalid_notification_state",
  "invalid_typed_outcome",
  "issued_offer_binding_mismatch",
  "request_response_id_mismatch",
]);

// Fixed input bounds; injectable through `limits` for tests only.
export const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 8 * 1024 * 1024,
  maxLineBytes: 1024 * 1024,
  maxRecords: 10_000,
});

export const REJECTION_REASONS = Object.freeze(new Set([
  "invalid_marker",
  "empty_input",
  "malformed_jsonl",
  "input_read_error",
  "input_too_large",
  "line_too_large",
  "too_many_records",
  "unrecognized_ledger_record",
  "invalid_request_attribution",
  "unsupported_source_generation",
  "non_canonical_typed_row",
  "hostile_input",
  "no_matching_row",
  "duplicate_matching_rows",
  "usage_error",
]));

class Rejection extends Error {
  constructor(reason) {
    super(reason);
    this.name = "Rejection";
    this.reason = reason;
  }
}

function reject(reason) {
  throw new Rejection(reason);
}

function exactKeys(value, keys) {
  try {
    return (
      value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
    );
  } catch {
    return false;
  }
}

function canonicalTimestampMs(value) {
  if (typeof value !== "string" || value.length !== 24 || !ISO_UTC_TIMESTAMP.test(value)) return null;
  const parsed = new Date(value);
  const ms = parsed.getTime();
  if (!Number.isFinite(ms) || parsed.toISOString() !== value) return null;
  return ms;
}

function isClosedBinding(binding) {
  if (!exactKeys(binding, ["issuedOfferDigest", "productSku", "resource", "tool"])) return false;
  if (!TOKEN_PATTERN.test(binding.tool) || !CLOSED_TOOLS.has(binding.tool)) return false;
  if (!SKU_PATTERN.test(binding.productSku)) return false;
  if (binding.productSku !== `samedaydesk-${binding.tool.replaceAll("_", "-")}`) return false;
  if (binding.resource !== `mcp://tool/${binding.tool}`) return false;
  return HEX_256.test(binding.issuedOfferDigest);
}

function isNullBinding(binding) {
  return exactKeys(binding, ["issuedOfferDigest", "productSku", "resource", "tool"])
    && binding.issuedOfferDigest === null
    && binding.productSku === null
    && binding.resource === null
    && binding.tool === null;
}

// Exact mirror of the stored-decision cross-field contract in
// commerce-events.mjs (isStoredMcpTypedDecisionFields).
function storedDecisionFieldsHold(value) {
  if (!ACTIONS.has(value.action)) return false;
  if (!RESULTS.has(value.result)) return false;
  if (!REASONS.has(value.reason)) return false;
  if (!APPLICATION_OUTCOMES.has(value.applicationOutcome)) return false;
  if (!SETTLEMENT_STATES.has(value.settlementState)) return false;
  if (typeof value.paymentPresent !== "boolean") return false;
  if (typeof value.paymentCredentialParsed !== "boolean") return false;
  if (typeof value.handlerInvoked !== "boolean") return false;
  if (value.action === "drop") {
    return value.result === "invalid"
      && DROP_REASONS.has(value.reason)
      && value.paymentPresent === false
      && value.paymentCredentialParsed === false
      && value.handlerInvoked === false
      && value.applicationOutcome === "not_run"
      && value.settlementState === "not_attempted"
      && isNullBinding(value.binding);
  }
  if (value.action !== "emit" || value.result === "invalid") return false;
  if (!isClosedBinding(value.binding)) return false;
  if (value.result === "paid_success") {
    return value.reason === "typed_paid_success"
      && value.applicationOutcome === "success"
      && value.handlerInvoked === true
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true
      && value.settlementState === "succeeded";
  }
  if (value.result === "challenge") {
    return value.reason === "typed_payment_required"
      && value.applicationOutcome === "not_run"
      && value.handlerInvoked === false
      && value.paymentCredentialParsed === false
      && value.settlementState === "not_attempted"
      && (value.paymentPresent === true || value.paymentPresent === false);
  }
  if (value.result === "application_failure") {
    return value.reason === "typed_application_failure"
      && value.applicationOutcome === "error"
      && value.handlerInvoked === true
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true;
  }
  if (value.result === "protocol_discovery") {
    return value.reason === "jsonrpc_notification"
      && value.applicationOutcome === "not_run"
      && value.handlerInvoked === false
      && value.paymentPresent === false
      && value.paymentCredentialParsed === false
      && value.settlementState === "not_attempted";
  }
  if (value.result === "replay_success") {
    return value.reason === "typed_replay_success"
      && value.applicationOutcome === "replay"
      && value.handlerInvoked === false
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true
      && value.settlementState === "succeeded";
  }
  if (value.result === "settlement_failure") {
    return value.reason === "typed_settlement_failure"
      && value.applicationOutcome === "success"
      && value.handlerInvoked === true
      && value.paymentPresent === true
      && value.paymentCredentialParsed === true
      && value.settlementState === "failed";
  }
  if (value.result === "telemetry_incomplete") {
    return (
      (value.reason === "verified_without_execution"
        && value.handlerInvoked === false
        && value.applicationOutcome === "not_run"
        && value.settlementState === "not_attempted")
      || (value.reason === "settlement_outcome_unknown"
        && value.handlerInvoked === true
        && value.applicationOutcome === "success"
        && value.settlementState === "unknown")
    ) && value.paymentPresent === true && value.paymentCredentialParsed === true;
  }
  return false;
}

// Exact mirror of isCanonicalMcpTypedCommerceEvent for the two allowed row
// shapes (legacy unattributed and attributed). Returns null when the row is
// canonical, otherwise the rejection reason.
function typedRowRejection(value) {
  if (value.v !== 4 || value.sourceContract !== SOURCE_CONTRACT) {
    return "unsupported_source_generation";
  }
  if (canonicalTimestampMs(value.ts) === null) return "non_canonical_typed_row";
  if (
    typeof value.id !== "string"
    || value.id.length !== 36
    || !EVENT_ID_PATTERN.test(value.id)
  ) {
    return "non_canonical_typed_row";
  }
  if (value.authority !== AUTHORITY || value.evidenceClass !== EVIDENCE_CLASS) {
    return "non_canonical_typed_row";
  }
  if (value.accounting !== false) return "non_canonical_typed_row";
  if (value.revenue !== false) return "non_canonical_typed_row";
  if (value.demand !== false) return "non_canonical_typed_row";
  if (value.independentUse !== false) return "non_canonical_typed_row";
  if (value.chainTruth !== false) return "non_canonical_typed_row";
  if (value.payerIdentity !== false) return "non_canonical_typed_row";
  if (!storedDecisionFieldsHold(value)) return "non_canonical_typed_row";
  return null;
}

function canonicalAttribution(attribution) {
  if (!exactKeys(attribution, ATTRIBUTION_KEYS)) return null;
  if (attribution.schemaVersion !== ATTRIBUTION_SCHEMA) return null;
  if (attribution.classification !== "validation") return null;
  if (attribution.evidence !== "internal_token") return null;
  if (!HEX_256.test(attribution.markerDigest)) return null;
  return {
    schemaVersion: ATTRIBUTION_SCHEMA,
    classification: "validation",
    evidence: "internal_token",
    markerDigest: attribution.markerDigest,
  };
}

// Classifies one already-parsed ledger record. Returns "match" for a row
// carrying this reconciliation's digest, "skip" for well-formed unrelated
// rows, or throws a Rejection. Fail-closed on hostile property access.
function classifyRecord(record, digest) {
  try {
    if (exactKeys(record, ATTRIBUTED_COMMERCE_KEYS)) {
      const attribution = canonicalAttribution(record.requestAttribution);
      if (attribution === null) reject("invalid_request_attribution");
      if (attribution.markerDigest !== digest) return "skip";
      const rowError = typedRowRejection(record);
      if (rowError !== null) reject(rowError);
      return "match";
    }
    if (exactKeys(record, TYPED_COMMERCE_KEYS)) {
      const rowError = typedRowRejection(record);
      if (rowError !== null) reject(rowError);
      return "skip";
    }
    reject("unrecognized_ledger_record");
  } catch (error) {
    if (error instanceof Rejection) throw error;
    // Property access threw (getter/proxy hostility): fail closed without
    // echoing any input-derived detail.
    reject("hostile_input");
  }
}

export function digestMcpTypedValidationMarker(marker) {
  if (typeof marker !== "string" || !MARKER_PATTERN.test(marker)) return null;
  return createHash("sha256").update(MARKER_DOMAIN).update(marker).digest("hex");
}

export function parseBoundedJsonlEvents(events, limits = DEFAULT_LIMITS) {
  const text = String(events ?? "");
  if (Buffer.byteLength(text, "utf8") > limits.maxInputBytes) reject("input_too_large");
  if (text.trim().length === 0) reject("empty_input");
  const lines = text.split("\n");
  if (lines.length - 1 > limits.maxRecords) reject("too_many_records");
  const records = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (Buffer.byteLength(line, "utf8") > limits.maxLineBytes) reject("line_too_large");
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      reject("malformed_jsonl");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      reject("malformed_jsonl");
    }
    records.push(parsed);
  }
  if (records.length === 0) reject("empty_input");
  if (records.length > limits.maxRecords) reject("too_many_records");
  return records;
}

function publicRowSummary(record) {
  return {
    id: record.id,
    ts: record.ts,
    action: record.action,
    result: record.result,
    reason: record.reason,
    applicationOutcome: record.applicationOutcome,
    settlementState: record.settlementState,
    binding: {
      tool: record.binding.tool,
      productSku: record.binding.productSku,
      resource: record.binding.resource,
    },
  };
}

// In-memory core. Accepts pre-parsed records so callers (and hostile tests)
// can exercise objects JSON.parse would never produce, e.g. null-prototype
// objects and throwing getters.
export function reconcileMcpTypedMarkerRecords(records, digest, limits = DEFAULT_LIMITS) {
  if (!HEX_256.test(digest)) reject("invalid_marker");
  if (!Array.isArray(records) || records.length === 0) reject("empty_input");
  if (records.length > limits.maxRecords) reject("too_many_records");
  let match = null;
  let matchCount = 0;
  for (const record of records) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      reject("malformed_jsonl");
    }
    if (classifyRecord(record, digest) === "match") {
      matchCount += 1;
      if (matchCount > 1) reject("duplicate_matching_rows");
      match = record;
    }
  }
  if (matchCount === 0) reject("no_matching_row");
  return {
    ok: true,
    schemaVersion: MCP_TYPED_MARKER_RECONCILIATION_SCHEMA,
    sourceContract: SOURCE_CONTRACT,
    markerDigest: digest,
    matchedRows: matchCount,
    row: publicRowSummary(match),
  };
}

export function reconcileMcpTypedMarker({ marker, events, limits = DEFAULT_LIMITS } = {}) {
  const digest = digestMcpTypedValidationMarker(marker);
  if (digest === null) reject("invalid_marker");
  const records = parseBoundedJsonlEvents(events, limits);
  return reconcileMcpTypedMarkerRecords(records, digest, limits);
}

function rejectionReason(error) {
  if (error instanceof Rejection && REJECTION_REASONS.has(error.reason)) return error.reason;
  return error instanceof Rejection ? "hostile_input" : "internal_error";
}

async function readBoundedStdin(stream, limits) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limits.maxInputBytes) throw new Rejection("input_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBoundedFile(eventsPath, limits) {
  let handle;
  try {
    handle = await open(eventsPath, "r");
    const chunks = [];
    let total = 0;
    while (true) {
      const remaining = limits.maxInputBytes - total;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limits.maxInputBytes) throw new Rejection("input_too_large");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } catch (error) {
    if (error instanceof Rejection) throw error;
    throw new Rejection("input_read_error");
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseArgv(argv) {
  let marker;
  let eventsPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--marker" || arg === "--events") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.length === 0) throw new Rejection("usage_error");
      if (arg === "--marker") {
        if (marker !== undefined) throw new Rejection("usage_error");
        marker = value;
      } else {
        if (eventsPath !== null) throw new Rejection("usage_error");
        eventsPath = value;
      }
      index += 1;
    } else if (arg.startsWith("--marker=")) {
      if (marker !== undefined) throw new Rejection("usage_error");
      marker = arg.slice("--marker=".length);
    } else if (arg.startsWith("--events=")) {
      if (eventsPath !== null) throw new Rejection("usage_error");
      eventsPath = arg.slice("--events=".length);
    } else {
      throw new Rejection("usage_error");
    }
  }
  if (typeof marker !== "string" || marker.length === 0) throw new Rejection("usage_error");
  if (eventsPath !== null && eventsPath.length === 0) throw new Rejection("usage_error");
  return { marker, eventsPath };
}

// Exit codes: 0 reconciled, 1 rejected, 2 usage error. Output carries reason
// codes and the derived digest only — never the raw marker or any token.
async function main(argv) {
  try {
    const { marker, eventsPath } = parseArgv(argv);
    const digest = digestMcpTypedValidationMarker(marker);
    if (digest === null) throw new Rejection("invalid_marker");
    const limits = DEFAULT_LIMITS;
    const events = eventsPath === null
      ? await readBoundedStdin(process.stdin, limits)
      : await readBoundedFile(eventsPath, limits);
    const result = reconcileMcpTypedMarker({ marker, events, limits });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const reason = rejectionReason(error);
    process.stderr.write(`${JSON.stringify({
      ok: false,
      schemaVersion: MCP_TYPED_MARKER_RECONCILIATION_SCHEMA,
      reason,
    })}\n`);
    return reason === "usage_error" ? 2 : 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
