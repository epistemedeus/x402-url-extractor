// Read-only exact excerpts from merchant base; see PIN.json. No journal writer.
export const SCHEMA = "samedaydesk.wave5.d17.http-response-validation.v1";

export const DELIVERY = Object.freeze({
  FULL_BOUNDED_CAPTURE: "full_bounded_capture",
  SOURCE_REFUSAL: "source_refusal",
  TRUNCATED_PARTIAL: "truncated_partial",
  UNSUPPORTED_CONTENT: "unsupported_content",
  TRANSPORT_FAILURE: "transport_failure",
  ENGINE_FAILURE: "engine_failure",
  MALFORMED_BODY: "malformed_body",
  MISSING_BODY: "missing_body",
  MERCHANT_HTTP_FAILURE: "merchant_http_failure",
  UNSUPPORTED_TARGET: "unsupported_target",
});

export const VERDICT = Object.freeze({
  PASS: "pass",
  INVALID: "invalid",
  UNKNOWN: "unknown",
});

export const SCHEMA_CONFORMANCE = Object.freeze({
  HOLDS: "holds",
  FAILS: "fails",
  NOT_APPLICABLE: "not_applicable",
});

export const SETTLEMENT_CLASS = Object.freeze({
  SIMULATED: "simulated",
  UNPAID: "unpaid",
  REAL_UNVERIFIED: "real_unverified",
});

export const VALIDATOR_AUTHORITY = "merchant_declared_schema";
export const VALIDATOR_SOURCE = "caller_observed_http_bytes";
export const USEFULNESS_UNKNOWN = "unknown";


export const FORWARD_SCHEMA_V1 = "samedaydesk.outcome-binding.forward.v1";
export const FORWARD_SCHEMA_V2 = "samedaydesk.outcome-binding.forward.v2";
export const FORWARD_PRODUCER_BASE_COMMIT = "ebd6834f3501ace0948b2ad5b7a3df9ab5c6b048";
export const FORWARD_WRITER_ID = "x402-url-extractor.createCommerceTelemetry.forward-v2";
export const FORWARD_SOURCE_PLANE = "forward_instrumenter";
export const FORWARD_BINDING_FILENAME = "commerce-outcome-binding.ndjson";
export const FORWARD_BINDING_ROTATED_FILENAME = "commerce-outcome-binding.1.ndjson";
export const TASK_REF_SCHEMA = "samedaydesk.outcome-task-ref.v1";
export const TASK_REF_FILENAME = "commerce-outcome-task-ref.ndjson";
export const TASK_REF_ROTATED_FILENAME = "commerce-outcome-task-ref.1.ndjson";
// Current file plus one rotation. A third rotation deletes the oldest file.
// Duplicate admission is only for event ids still in those two files.
export const TASK_REF_RETAINED_GENERATIONS = 2;
const TASK_REF_EPOCH = "samedaydesk.outcome-task-ref.epoch.v1";
const OPAQUE_TASK_REF = /^t[a-f0-9]{62}$/;
// Settlement admission fsyncs the journal file and, after a rotation, the
// directory. That is durable only on a local filesystem that reports success
// after the file bytes and the directory entry are stable. Copying an older
// backup onto the same path is outside this guarantee and is not detected.
export const FORWARD_JOURNAL_DURABILITY = "local-filesystem-fsync-rename-v1";
export const RECONCILIATION_SCHEMA = "samedaydesk.commerce-settlement-reconciliation.v1";
export const REUSE_AUTHORITY = "authenticated_producer_observation";
export const SETTLEMENT_AUTHORITY_READBACK = "runtime_readback";
export const SETTLEMENT_AUTHORITY_MOCKED = "mocked_settlement_boundary";
export const HISTORICAL_VALIDATOR_VERDICT = "not_checked";
export const HISTORICAL_VALIDATOR_AUTHORITY = "none";
export const HISTORICAL_VALIDATOR_SOURCE = "http_runtime_not_checked";

const OPERATION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TX = /^0x[0-9a-f]{64}$/;
const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;
const COHORTS = new Set(["controlled_test", "external_unknown", "owner_qa", "sponsored_trial"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const STAGES = new Set(["discovery", "call", "transport", "delivery", "settlement", "retained_use"]);
const PLANES = new Set([
  "journey_marker",
  "transport_observation",
  "schema_delivery",
  "economic_settlement",
  "retained_use",
]);
const DELIVERY_CLASSES = new Set(Object.values(DELIVERY));
const VERDICTS = new Set([VERDICT.PASS, VERDICT.INVALID, VERDICT.UNKNOWN, HISTORICAL_VALIDATOR_VERDICT]);
const SETTLEMENT_CLASSES = new Set([
  SETTLEMENT_CLASS.SIMULATED,
  SETTLEMENT_CLASS.UNPAID,
  SETTLEMENT_CLASS.REAL_UNVERIFIED,
  "reconciled",
]);
const MOCKED_BOUNDARY = new Set([SETTLEMENT_CLASS.SIMULATED, SETTLEMENT_CLASS.UNPAID]);
const CALL_RESULTS = new Set([
  "challenge",
  "validation_failure",
  "paid_route_response",
  "request",
  "service_failure",
  "paid_success",
  "replay_success",
]);

export const FORWARD_V2_KEYS = Object.freeze([
  "brand",
  "cohort",
  "commerceEventId",
  "correctionOf",
  "deliveryClass",
  "eventId",
  "evidencePlane",
  "method",
  "operationId",
  "producerBaseCommit",
  "receiptDigest",
  "reuseAuthority",
  "route",
  "schemaVersion",
  "settlementAuthority",
  "settlementClass",
  "settlementReference",
  "sourcePlane",
  "stage",
  "usefulness",
  "validatorAuthority",
  "validatorSource",
  "validatorVerdict",
  "valueAtomic",
  "writerId",
]);


const TASK_REF_KEYS = Object.freeze([
  "cohort",
  "commerceEventId",
  "eventId",
  "operationId",
  "schemaVersion",
  "taskRef",
  "writerId",
]);

function foldIdentity(value) {
  return String(value).toLowerCase();
}

function obviousIdentity(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return true;
  const folded = foldIdentity(value);
  if (folded.includes("@") || folded.includes("://")) return true;
  if (folded.startsWith("mailto:") || folded.startsWith("http:") || folded.startsWith("https:")) return true;
  if (folded.startsWith("0x") || folded.startsWith("bc1") || folded.startsWith("tb1") || folded.startsWith("ltc1")) return true;
  if (/(^|[^a-z0-9])(bearer|sk-|pk_live|pk_test)/.test(folded)) return true;
  if (folded.startsWith("eyj") && folded.includes(".")) return true;
  if (/^[1-9a-hj-np-z]{32,44}$/.test(folded)) return true;
  return false;
}


export function isTaskRefRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const keys = Object.keys(record).sort();
  if (keys.length !== TASK_REF_KEYS.length || keys.some((key, index) => key !== TASK_REF_KEYS[index])) return false;
  if (record.schemaVersion !== TASK_REF_SCHEMA || record.writerId !== FORWARD_WRITER_ID) return false;
  if (!OPERATION_ID_RE.test(record.operationId) || !OPAQUE_TASK_REF.test(record.taskRef || "")) return false;
  if (obviousIdentity(record.taskRef)) return false;
  if (!COHORTS.has(record.cohort)) return false;
  return UUID_V4.test(record.commerceEventId || "") && UUID_V4.test(record.eventId || "");
}


function nullableHex(value) {
  return value === null || HEX64.test(value);
}

function nullableTx(value) {
  return value === null || TX.test(value);
}

function routeOk(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.startsWith("/") && !/\s/.test(value);
}

export function isSchemaValidDeliveryEvidence(record) {
  return Boolean(record)
    && record.schemaVersion === FORWARD_SCHEMA_V2
    && record.stage === "delivery"
    && record.evidencePlane === "schema_delivery"
    && record.validatorVerdict === VERDICT.PASS
    && record.validatorAuthority === VALIDATOR_AUTHORITY
    && record.validatorSource === VALIDATOR_SOURCE
    && record.deliveryClass === DELIVERY.FULL_BOUNDED_CAPTURE
    && record.usefulness === USEFULNESS_UNKNOWN
    && record.settlementAuthority === null
    && record.settlementReference === null
    && record.reuseAuthority === null
    && HEX64.test(record.receiptDigest || "");
}

export function isForwardV2Record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== FORWARD_V2_KEYS.length || keys.some((key, index) => key !== FORWARD_V2_KEYS[index])) return false;
  if (value.schemaVersion !== FORWARD_SCHEMA_V2 || value.sourcePlane !== FORWARD_SOURCE_PLANE) return false;
  if (value.producerBaseCommit !== FORWARD_PRODUCER_BASE_COMMIT || value.writerId !== FORWARD_WRITER_ID) return false;
  if (value.brand !== "samedaydesk" && value.brand !== "ein-llc" && value.brand !== "neomorphic") return false;
  if (!COHORTS.has(value.cohort) || !OPERATION_ID_RE.test(value.operationId)) return false;
  if (!UUID_V4.test(value.eventId) || !UUID_V4.test(value.commerceEventId)) return false;
  if (!STAGES.has(value.stage) || !PLANES.has(value.evidencePlane)) return false;
  if (!routeOk(value.route) || !METHODS.has(value.method)) return false;
  if (!nullableHex(value.receiptDigest)) return false;
  if (value.correctionOf !== null && !OPERATION_ID_RE.test(value.correctionOf)) return false;
  if (value.deliveryClass !== null && !DELIVERY_CLASSES.has(value.deliveryClass)) return false;
  if (value.validatorVerdict !== null && !VERDICTS.has(value.validatorVerdict)) return false;
  if (value.validatorAuthority !== null && value.validatorAuthority !== VALIDATOR_AUTHORITY && value.validatorAuthority !== HISTORICAL_VALIDATOR_AUTHORITY) {
    return false;
  }
  if (value.validatorSource !== null && value.validatorSource !== VALIDATOR_SOURCE && value.validatorSource !== HISTORICAL_VALIDATOR_SOURCE) {
    return false;
  }
  if (value.usefulness !== null && value.usefulness !== USEFULNESS_UNKNOWN) return false;
  if (value.reuseAuthority !== null && value.reuseAuthority !== REUSE_AUTHORITY) return false;
  if (value.settlementAuthority !== null && value.settlementAuthority !== SETTLEMENT_AUTHORITY_READBACK && value.settlementAuthority !== SETTLEMENT_AUTHORITY_MOCKED) {
    return false;
  }
  if (value.settlementClass !== null && !SETTLEMENT_CLASSES.has(value.settlementClass)) return false;
  if (!nullableTx(value.settlementReference)) return false;
  if (value.valueAtomic !== null && !ATOMIC.test(value.valueAtomic)) return false;
  if (value.validatorVerdict === HISTORICAL_VALIDATOR_VERDICT && value.stage === "delivery") return false;
  if (value.stage === "delivery" && value.evidencePlane !== "schema_delivery") return false;
  if (value.stage === "transport" && value.evidencePlane !== "transport_observation") return false;
  if ((value.stage === "discovery" || value.stage === "call") && value.evidencePlane !== "journey_marker") return false;
  if (value.stage === "settlement" && value.evidencePlane !== "economic_settlement") return false;
  if (value.stage === "retained_use" && value.evidencePlane !== "retained_use") return false;
  if ((value.stage === "delivery" || value.stage === "transport" || value.stage === "retained_use") && value.receiptDigest === null) {
    return false;
  }
  if (value.stage === "settlement" && value.receiptDigest === null) return false;
  return true;
}

