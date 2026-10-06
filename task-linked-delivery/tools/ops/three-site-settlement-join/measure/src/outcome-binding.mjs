import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CollectError } from "./project.mjs";
import { containsRestrictedKey } from "./restricted.mjs";
import {
  BINDING_ATTEMPT_OF,
  BINDING_JOB_ID,
  BINDING_SCHEMA,
  FORWARD_SCHEMA,
  FORWARD_SCHEMA_V2,
  FORWARD_WRITER_ID,
  OPERATION_ID,
  PRODUCER_COMMIT,
  PUBLIC_AGGREGATE_URL,
} from "./constants.mjs";

const PIN_URL = new URL("../pins/sponsored-outflow.json", import.meta.url);
const PAYMENT_EVIDENCE_SCHEMA = "samedaydesk.commerce-payment-evidence-readout.v1";
const RARE_SCHEMA = "samedaydesk.commerce-rare-funnel-evidence.v1";
const MAX_FETCH_BYTES = 512_000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTOR_KEY = /^[0-9a-f]{24}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TX = /^0x[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OPERATION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ATOMIC = /^(0|[1-9][0-9]{0,77})$/;
const QUERY_KEY = /^[A-Za-z0-9_-]{1,64}$/;

const ORIGIN_CLASSES = new Set(["internal", "scanner", "owner_monitor", "external", "crawler"]);
const KINDS = new Set(["discovery", "referral", "paid", "unmatched", "excluded"]);
const RESULTS = new Set([
  "unmatched", "discovery", "request", "challenge", "service_failure",
  "validation_failure", "protocol_discovery", "replay_success", "paid_success", "paid_route_response",
]);
const CONSTRUCTION = new Set(["undeclared", "not_measured", "constructed", "missing_required_input"]);
const PROTOCOLS = new Set(["x402", "mpp"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SOURCES = new Set([
  "agent402", "coinbase-bazaar", "circle-agent-marketplace", "mcp-registry", "smithery", "glama",
  "mppscan", "mpp-ecosystem", "agentcash", "a2a-ecosystem", "openai-search", "openai-user",
  "openai-training", "anthropic-search", "anthropic-user", "anthropic-training", "perplexity-search",
  "perplexity-user", "google-vertex-agent", "generic-agent-indexer", "declared-receipt-referral",
  "agent-skills", "agentictrade", "agentverse", "aws-agentcore", "claude-code-marketplace", "goose-native",
  "direct-or-unattributed",
]);
const SOURCE_KINDS = new Set(["declared_header", "declared_receipt_referral", "observed_user_agent", "none"]);
const PAYER_CLASSES = new Set(["internal", "validation", "incentivized", "affiliated", "independent", "unclassified"]);
const STAGES = Object.freeze(["discovery", "call", "delivery", "settlement", "retained_use"]);
const COHORTS = new Set(["controlled_test", "external_unknown", "owner_qa", "sponsored_trial"]);
const CALL_RESULTS = new Set(["challenge", "validation_failure", "paid_route_response", "request", "service_failure", "paid_success", "replay_success"]);

const V3_KEYS = Object.freeze([
  "actor", "agentDiscoverySource", "durationMs", "id", "kind", "matched", "method",
  "originClass", "paymentActor", "paymentCredentialParsed", "paymentFailureCode",
  "paymentIdentifier", "paymentPresent", "paymentProtocol", "protocolsOffered",
  "queryKeys", "replayed", "requestConstruction", "requestConstructionRequiredKeyCount",
  "result", "route", "settlementAmountAtomic", "settlementCurrency", "settlementNetwork",
  "settlementReference", "status", "ts", "v",
]);
const V3_SPLIT_KEYS = Object.freeze([
  "declaredAgentDiscoverySource", "discoverySourceKind", "observedAgentDiscoverySource",
]);
const PAID_KEYS = Object.freeze([
  "credentialFingerprint", "id", "method", "originClass", "payerClass", "paymentProtocol",
  "requestDigest", "requestStartedAt", "responseDigest", "responseFinishedAt", "route",
  "runtimeAttribution", "settlementReference", "source", "v", "validatorAuthority",
  "validatorSource", "validatorVerdict",
]);
const RARE_KEYS = Object.freeze([
  "actor", "agentDiscoverySource", "captureProvenance", "captureVersion", "id", "kind",
  "matched", "method", "originClass", "paymentActor", "paymentCredentialParsed",
  "paymentFailureCode", "paymentPresent", "paymentProtocol", "replayed", "result", "route",
  "schemaVersion", "status", "ts", "usefulness", "v",
]);
const FORWARD_KEYS = Object.freeze([
  "brand", "cohort", "correctionOf", "eventId", "method", "operationId", "producerCommit",
  "receiptDigest", "route", "schemaVersion", "settlementReference", "sourcePlane", "stage",
  "valueAtomic",
]);
const FORWARD_V2_KEYS = Object.freeze([
  "brand", "cohort", "commerceEventId", "correctionOf", "deliveryClass", "eventId", "evidencePlane",
  "method", "operationId", "producerBaseCommit", "receiptDigest", "reuseAuthority", "route",
  "schemaVersion", "settlementAuthority", "settlementClass", "settlementReference", "sourcePlane",
  "stage", "usefulness", "validatorAuthority", "validatorSource", "validatorVerdict", "valueAtomic",
  "writerId",
]);
const DELIVERY_CLASSES = new Set([
  "full_bounded_capture", "source_refusal", "truncated_partial", "unsupported_content",
  "transport_failure", "engine_failure", "malformed_body", "missing_body", "merchant_http_failure",
  "unsupported_target",
]);
const EVIDENCE_PLANES = new Set([
  "journey_marker", "transport_observation", "schema_delivery", "economic_settlement", "retained_use",
]);
const V2_STAGES = new Set(["discovery", "call", "transport", "delivery", "settlement", "retained_use"]);

const MESSAGES = Object.freeze({
  invalid_source: "source is not a readable outcome export",
  restricted_fields: "restricted source fields were not projected",
  revenue_claim: "a source presented a settlement or a balance difference as recognized revenue",
  aggregate_customer_plane: "the public aggregate customer plane is null and cannot be filled in",
  public_aggregate_unavailable: "the public commerce-demand document was not readable",
  public_aggregate_rejected: "the public commerce-demand document is outside the read-only contract",
  wrong_source_schema: "source schema is not an outcome export or the public aggregate",
  sponsored_pin_mismatch: "the closed sponsored-expense pin is not the expected record",
});

function fail(code) {
  throw new CollectError(code, MESSAGES[code] || MESSAGES.invalid_source);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sameKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

const PAYMENT_FAILURE_EVIDENCE_KEY = "paymentFailureEvidence";
const VERIFIER_TEXT_CODES = new Set([
  "extension_mismatch", "payment_terms_mismatch", "signature_invalid", "payment_expired",
  "payment_replay_rejected", "insufficient_funds", "payment_service_unavailable",
  "payment_verification_failed",
]);
const HTTP_STATUS_CODES = new Set([
  "payment_service_unavailable", "request_binding_conflict", "application_validation_failed",
  "unknown_failure",
]);

function withOptionalPaymentFailureEvidence(keys, value) {
  const copy = [...keys];
  if (hasOwn(value, PAYMENT_FAILURE_EVIDENCE_KEY)) copy.push(PAYMENT_FAILURE_EVIDENCE_KEY);
  return copy;
}

function paymentFailureEvidenceOk(value) {
  if (!hasOwn(value, PAYMENT_FAILURE_EVIDENCE_KEY)) return true;
  const evidence = value.paymentFailureEvidence;
  const code = value.paymentFailureCode;
  if (evidence === null) return code === null;
  if (typeof evidence !== "string" || typeof code !== "string") return false;
  if (evidence === "generic_402") return code === "payment_verification_failed";
  if (evidence === "request_shape") return code === "missing_required_input";
  if (evidence === "verifier_text") return VERIFIER_TEXT_CODES.has(code);
  if (evidence === "http_status") return HTTP_STATUS_CODES.has(code);
  return false;
}

function isoMs(value) {
  if (typeof value !== "string" || !ISO.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return parsed.getTime();
}

function atomic(value) {
  return typeof value === "string" && ATOMIC.test(value) ? value : null;
}

function loadPin() {
  let pin;
  try {
    pin = JSON.parse(readFileSync(PIN_URL, "utf8"));
  } catch {
    fail("sponsored_pin_mismatch");
  }
  if (
    pin?.schema !== "pilot.s17.sponsored-outflow-pin.v1"
    || pin.atomic !== "200000"
    || pin.claim !== "closed"
    || pin.secondPay !== false
    || pin.recognizedRevenue !== false
    || pin.class !== "sponsored_evaluation_expense"
    || pin.movementRef !== "0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37"
  ) {
    fail("sponsored_pin_mismatch");
  }
  const bytes = readFileSync(PIN_URL);
  return {
    pin: "pilot.s17.sponsored-outflow-pin.v1",
    atomic: pin.atomic,
    movementRef: pin.movementRef,
    claim: "closed",
    class: pin.class,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    touched: false,
    secondPay: false,
    recognizedRevenue: false,
  };
}

function claimsRevenue(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => claimsRevenue(item, seen));
  if (value.recognizedRevenue === true || value.isRevenue === true || value.booksDeltaAsRevenue === true) {
    return true;
  }
  if (value.organicAttribution === true || value.organic === true) return true;
  if (typeof value.recognizedRevenueAtomic === "string" && value.recognizedRevenueAtomic !== "0") return true;
  if (value.class === "revenue" && hasOwn(value, "direction")) return true;
  return Object.values(value).some((item) => claimsRevenue(item, seen));
}

function classifyResult(event) {
  if (!event.matched) return "unmatched";
  if (event.kind === "discovery" || event.kind === "referral") return "discovery";
  if (event.kind !== "paid") return "request";
  if (event.status === 402) return "challenge";
  if (event.status >= 500) return "service_failure";
  if (event.status >= 400) return "validation_failure";
  if (event.route === "/mcp" && !event.paymentPresent && event.status >= 200 && event.status < 300) {
    return "protocol_discovery";
  }
  if (event.replayed && event.paymentPresent && event.status >= 200 && event.status < 300) return "replay_success";
  if (event.paymentPresent && event.status >= 200 && event.status < 300) return "paid_success";
  return "paid_route_response";
}

function paymentCrossOk(value) {
  if (typeof value.paymentPresent !== "boolean" || typeof value.paymentCredentialParsed !== "boolean") return false;
  if (value.paymentPresent) {
    if (!PROTOCOLS.has(value.paymentProtocol)) return false;
  } else if (value.paymentProtocol !== null || value.paymentCredentialParsed !== false || value.paymentActor !== null || value.paymentIdentifier !== null) {
    return false;
  }
  const actorOk = (item) => item === null || ACTOR_KEY.test(item);
  if (!actorOk(value.paymentActor) || !actorOk(value.paymentIdentifier)) return false;
  if (value.paymentCredentialParsed) {
    if (value.paymentPresent !== true || !ACTOR_KEY.test(value.paymentActor || "")) return false;
  } else if (value.paymentActor !== null || value.paymentIdentifier !== null) {
    return false;
  }
  if (value.paymentIdentifier !== null) {
    return value.paymentProtocol === "x402" && value.paymentCredentialParsed === true;
  }
  return true;
}

function originCrossOk(value) {
  if (value.originClass === "crawler") return value.agentDiscoverySource !== null && value.paymentPresent === false;
  if (value.originClass === "external") return value.paymentPresent === true || value.agentDiscoverySource === null;
  return true;
}

function isV3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.v !== 3) return false;
  const split = V3_SPLIT_KEYS.filter((key) => hasOwn(value, key));
  const base = split.length === 0 ? V3_KEYS : [...V3_KEYS, ...V3_SPLIT_KEYS];
  const expected = withOptionalPaymentFailureEvidence(base, value).sort();
  if (split.length !== 0 && split.length !== V3_SPLIT_KEYS.length) return false;
  if (!sameKeys(value, expected)) return false;
  if (!UUID_V4.test(value.id) || isoMs(value.ts) === null || !ACTOR_KEY.test(value.actor)) return false;
  if (!ORIGIN_CLASSES.has(value.originClass)) return false;
  if (value.agentDiscoverySource !== null && !SOURCES.has(value.agentDiscoverySource)) return false;
  if (!METHODS.has(value.method) || typeof value.route !== "string" || value.route.length > 200 || !value.route.startsWith("/") || /\s/.test(value.route)) {
    return false;
  }
  if (!KINDS.has(value.kind) || typeof value.matched !== "boolean") return false;
  if (!Array.isArray(value.queryKeys) || value.queryKeys.length > 20 || value.queryKeys.some((key) => typeof key !== "string" || !QUERY_KEY.test(key))) {
    return false;
  }
  if (!CONSTRUCTION.has(value.requestConstruction) || !Number.isInteger(value.requestConstructionRequiredKeyCount)) return false;
  if (value.requestConstructionRequiredKeyCount < 0 || value.requestConstructionRequiredKeyCount > 20) return false;
  if (!paymentCrossOk(value) || !originCrossOk(value)) return false;
  if (!Array.isArray(value.protocolsOffered) || value.protocolsOffered.some((item) => !PROTOCOLS.has(item))) return false;
  if (typeof value.replayed !== "boolean") return false;
  if (value.settlementReference !== null && !TX.test(value.settlementReference)) return false;
  if (value.settlementAmountAtomic !== null && atomic(value.settlementAmountAtomic) === null) return false;
  if (value.settlementReference === null && (value.settlementAmountAtomic !== null || value.settlementNetwork !== null || value.settlementCurrency !== null)) {
    return false;
  }
  for (const key of ["settlementNetwork", "settlementCurrency"]) {
    if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > 200)) return false;
  }
  if (!Number.isInteger(value.status) || value.status < 100 || value.status > 999) return false;
  if (value.paymentFailureCode !== null && (typeof value.paymentFailureCode !== "string" || value.paymentFailureCode.length > 64)) return false;
  if (!paymentFailureEvidenceOk(value)) return false;
  if (!RESULTS.has(value.result) || !Number.isInteger(value.durationMs) || value.durationMs < 0) return false;
  if (value.result !== classifyResult(value)) return false;
  if (split.length === 3) {
    if (value.declaredAgentDiscoverySource !== null && !SOURCES.has(value.declaredAgentDiscoverySource)) return false;
    if (value.observedAgentDiscoverySource !== null && !SOURCES.has(value.observedAgentDiscoverySource)) return false;
    if (!SOURCE_KINDS.has(value.discoverySourceKind)) return false;
  }
  return true;
}

function isPaidEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !sameKeys(value, PAID_KEYS)) return false;
  if (value.v !== 1 || !UUID_V4.test(value.id)) return false;
  if (isoMs(value.requestStartedAt) === null || isoMs(value.responseFinishedAt) === null) return false;
  if (isoMs(value.responseFinishedAt) < isoMs(value.requestStartedAt)) return false;
  if (!METHODS.has(value.method) || typeof value.route !== "string" || !value.route.startsWith("/")) return false;
  if (!ORIGIN_CLASSES.has(value.originClass) || !SOURCES.has(value.source) || !PAYER_CLASSES.has(value.payerClass)) return false;
  if (!HEX64.test(value.requestDigest) || !HEX64.test(value.credentialFingerprint) || !HEX64.test(value.responseDigest)) return false;
  if (value.settlementReference !== null && !TX.test(value.settlementReference)) return false;
  if (!PROTOCOLS.has(value.paymentProtocol)) return false;
  return value.runtimeAttribution === "http"
    && value.validatorVerdict === "not_checked"
    && value.validatorAuthority === "none"
    && value.validatorSource === "http_runtime_not_checked";
}

function isRare(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!sameKeys(value, withOptionalPaymentFailureEvidence(RARE_KEYS, value).sort())) return false;
  if (!paymentFailureEvidenceOk(value)) return false;
  if (value.v !== 1 || value.schemaVersion !== RARE_SCHEMA) return false;
  if (value.captureVersion !== "rare_funnel_capture_v1") return false;
  if (value.captureProvenance !== "http_middleware" && value.captureProvenance !== "mcp_typed_adapter") return false;
  if (!UUID_V4.test(value.id) || isoMs(value.ts) === null || !ACTOR_KEY.test(value.actor)) return false;
  if (!ORIGIN_CLASSES.has(value.originClass)) return false;
  if (value.agentDiscoverySource !== null && !SOURCES.has(value.agentDiscoverySource)) return false;
  if (value.paymentActor !== null && !ACTOR_KEY.test(value.paymentActor)) return false;
  if (value.kind !== "paid" || value.matched !== true || value.paymentPresent !== true) return false;
  if (!METHODS.has(value.method) || typeof value.route !== "string") return false;
  if (!PROTOCOLS.has(value.paymentProtocol) || typeof value.paymentCredentialParsed !== "boolean") return false;
  if (!Number.isInteger(value.status) || typeof value.replayed !== "boolean" || !RESULTS.has(value.result)) return false;
  return value.usefulness === "unknown";
}

function isForward(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !sameKeys(value, FORWARD_KEYS)) return false;
  if (value.schemaVersion !== FORWARD_SCHEMA || value.sourcePlane !== "forward_instrumenter") return false;
  if (value.producerCommit !== PRODUCER_COMMIT) return false;
  if (!UUID_V4.test(value.eventId) || !OPERATION_ID_RE.test(value.operationId)) return false;
  if (!STAGES.includes(value.stage) || !COHORTS.has(value.cohort)) return false;
  if (value.brand !== "samedaydesk" && value.brand !== "ein-llc" && value.brand !== "neomorphic") return false;
  if (value.route !== null && (typeof value.route !== "string" || value.route.length > 200 || !value.route.startsWith("/") || /\s/.test(value.route))) {
    return false;
  }
  if (value.method !== null && !METHODS.has(value.method)) return false;
  if (value.receiptDigest !== null && !HEX64.test(value.receiptDigest)) return false;
  if (value.settlementReference !== null && !TX.test(value.settlementReference)) return false;
  if (value.valueAtomic !== null && atomic(value.valueAtomic) === null) return false;
  if (value.correctionOf !== null && !OPERATION_ID_RE.test(value.correctionOf)) return false;
  if ((value.stage === "delivery" || value.stage === "retained_use") && value.receiptDigest === null) return false;
  if (value.stage === "settlement" && value.settlementReference === null) return false;
  return true;
}

function isForwardV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !sameKeys(value, FORWARD_V2_KEYS)) return false;
  if (value.schemaVersion !== FORWARD_SCHEMA_V2 || value.sourcePlane !== "forward_instrumenter") return false;
  if (value.producerBaseCommit !== PRODUCER_COMMIT || value.writerId !== FORWARD_WRITER_ID) return false;
  if (!UUID_V4.test(value.eventId) || !UUID_V4.test(value.commerceEventId)) return false;
  if (!OPERATION_ID_RE.test(value.operationId) || !V2_STAGES.has(value.stage) || !COHORTS.has(value.cohort)) return false;
  if (!EVIDENCE_PLANES.has(value.evidencePlane)) return false;
  if (value.brand !== "samedaydesk" && value.brand !== "ein-llc" && value.brand !== "neomorphic") return false;
  if (value.route !== null && (typeof value.route !== "string" || value.route.length > 200 || !value.route.startsWith("/") || /\s/.test(value.route))) {
    return false;
  }
  if (typeof value.route !== "string") return false;
  if (value.method !== null && !METHODS.has(value.method)) return false;
  if (!METHODS.has(value.method)) return false;
  if (value.receiptDigest !== null && !HEX64.test(value.receiptDigest)) return false;
  if (value.settlementReference !== null && !TX.test(value.settlementReference)) return false;
  if (value.valueAtomic !== null && atomic(value.valueAtomic) === null) return false;
  if (value.correctionOf !== null && !OPERATION_ID_RE.test(value.correctionOf)) return false;
  if (value.deliveryClass !== null && !DELIVERY_CLASSES.has(value.deliveryClass)) return false;
  if (value.validatorVerdict !== null && !["pass", "invalid", "unknown", "not_checked"].includes(value.validatorVerdict)) return false;
  if (value.validatorAuthority !== null && value.validatorAuthority !== "merchant_declared_schema" && value.validatorAuthority !== "none") return false;
  if (value.validatorSource !== null && value.validatorSource !== "caller_observed_http_bytes" && value.validatorSource !== "http_runtime_not_checked") return false;
  if (value.usefulness !== null && value.usefulness !== "unknown") return false;
  if (value.reuseAuthority !== null && value.reuseAuthority !== "authenticated_producer_observation") return false;
  if (value.settlementAuthority !== null && value.settlementAuthority !== "runtime_readback" && value.settlementAuthority !== "mocked_settlement_boundary") return false;
  if (value.settlementClass !== null && !["unpaid", "simulated", "real_unverified", "reconciled"].includes(value.settlementClass)) return false;
  if (value.validatorVerdict === "not_checked" && value.stage === "delivery") return false;
  if (value.stage === "delivery" && value.evidencePlane !== "schema_delivery") return false;
  if (value.stage === "transport" && value.evidencePlane !== "transport_observation") return false;
  if ((value.stage === "discovery" || value.stage === "call") && value.evidencePlane !== "journey_marker") return false;
  if (value.stage === "settlement" && value.evidencePlane !== "economic_settlement") return false;
  if (value.stage === "retained_use" && value.evidencePlane !== "retained_use") return false;
  if ((value.stage === "delivery" || value.stage === "transport" || value.stage === "retained_use" || value.stage === "settlement") && value.receiptDigest === null) {
    return false;
  }
  return true;
}

function isSchemaValidForwardDelivery(record) {
  return isForwardV2(record)
    && record.stage === "delivery"
    && record.evidencePlane === "schema_delivery"
    && record.validatorVerdict === "pass"
    && record.validatorAuthority === "merchant_declared_schema"
    && record.validatorSource === "caller_observed_http_bytes"
    && record.deliveryClass === "full_bounded_capture"
    && record.usefulness === "unknown"
    && record.settlementAuthority === null
    && record.settlementReference === null
    && record.reuseAuthority === null
    && HEX64.test(record.receiptDigest);
}

function isAdmittedSettlement(record) {
  if (!isForwardV2(record) || record.stage !== "settlement" || record.evidencePlane !== "economic_settlement") return false;
  if (record.usefulness !== "unknown" || !HEX64.test(record.receiptDigest || "")) return false;
  if (record.settlementAuthority === "mocked_settlement_boundary") {
    return (record.settlementClass === "unpaid" || record.settlementClass === "simulated")
      && record.settlementReference === null
      && record.valueAtomic === null;
  }
  if (record.settlementAuthority === "runtime_readback") {
    return record.settlementClass === "reconciled"
      && TX.test(record.settlementReference || "")
      && atomic(record.valueAtomic) !== null;
  }
  return false;
}

function isAdmittedReuse(record) {
  return isForwardV2(record)
    && record.stage === "retained_use"
    && record.evidencePlane === "retained_use"
    && record.reuseAuthority === "authenticated_producer_observation"
    && record.settlementAuthority === null
    && record.settlementReference === null
    && record.valueAtomic === null
    && record.usefulness === "unknown"
    && HEX64.test(record.receiptDigest || "")
    && (record.correctionOf === null || record.correctionOf === record.operationId);
}

function admittedStage(record) {
  if (record.schemaVersion === FORWARD_SCHEMA) {
    return record.stage === "discovery" || record.stage === "call" ? record.stage : null;
  }
  if (record.stage === "discovery" || record.stage === "call") return record.stage;
  if (isSchemaValidForwardDelivery(record)) return "delivery";
  if (isAdmittedSettlement(record)) return "settlement";
  if (isAdmittedReuse(record)) return "retained_use";
  return null;
}

function settlementIdentity(record) {
  if (record.settlementAuthority === "mocked_settlement_boundary") {
    return `mocked:${record.settlementClass}:${record.receiptDigest}`;
  }
  return record.settlementReference;
}

function isPublicAggregate(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.generatedAt === "string"
    && value.byResult
    && typeof value.byResult === "object"
    && !Array.isArray(value.records)
    && (typeof value.externalEvents === "number" || value.coverage);
}

function cohortFor(originClass, payerClass) {
  if (payerClass === "incentivized") return "sponsored_trial";
  if (originClass === "owner_monitor") return "owner_qa";
  if (originClass === "internal" || payerClass === "internal" || payerClass === "validation") return "controlled_test";
  if (originClass === "crawler" || originClass === "scanner") return "excluded_reach";
  return "external_unknown";
}

function emptyLabels() {
  return {
    controlled_test: 0,
    external_unknown: 0,
    owner_qa: 0,
    sponsored_trial: 0,
    excluded_reach: 0,
  };
}

function bump(labels, cohort) {
  if (hasOwn(labels, cohort)) labels[cohort] += 1;
}

function stagesForEvent(event) {
  const stages = [];
  if (event.result === "discovery" || event.result === "protocol_discovery") stages.push("discovery");
  else if (CALL_RESULTS.has(event.result)) stages.push("call");
  if (event.settlementReference) stages.push("settlement");
  return stages;
}

function blankOp(operationId) {
  return {
    operationId,
    records: [],
    brands: new Set(),
    cohorts: new Set(),
    stageCounts: Object.fromEntries(STAGES.map((stage) => [stage, 0])),
    receipts: [],
    settlements: [],
  };
}

function finishOperations(ops, pin) {
  const digestOwners = new Map();
  for (const op of ops.values()) {
    for (const record of op.records) {
      if (!record.receiptDigest) continue;
      const owners = digestOwners.get(record.receiptDigest) || new Set();
      owners.add(op.operationId);
      digestOwners.set(record.receiptDigest, owners);
    }
  }
  const finished = [];
  for (const op of [...ops.values()].sort((left, right) => left.operationId.localeCompare(right.operationId))) {
    const quarantine = [];
    if (op.brands.size !== 1 || !op.brands.has("samedaydesk")) quarantine.push("wrong_brand");
    if (op.cohorts.size !== 1) quarantine.push("mixed_cohort");
    const schemaDeliveryReceipts = new Set(op.records.filter(isSchemaValidForwardDelivery).map((record) => record.receiptDigest));
    const legacyDeliveryReceipts = new Set(op.records
      .filter((record) => record.schemaVersion === FORWARD_SCHEMA && record.stage === "delivery")
      .map((record) => record.receiptDigest));
    let legacyUnvalidated = false;
    let cross = false;
    for (const record of op.records) {
      if (record.schemaVersion === FORWARD_SCHEMA && ["delivery", "settlement", "retained_use"].includes(record.stage)) {
        legacyUnvalidated = true;
      }
      if (!record.receiptDigest) continue;
      const owners = digestOwners.get(record.receiptDigest);
      if (owners && owners.size > 1) cross = true;
      if (record.correctionOf && record.correctionOf !== op.operationId) quarantine.push("wrong_operation");
      if (record.settlementReference === pin.movementRef) quarantine.push("closed_sponsored_expense");
    }
    if (legacyUnvalidated) quarantine.push("legacy_unvalidated_evidence");
    if (cross) quarantine.push("wrong_operation");
    for (const record of op.records) {
      if (record.stage !== "settlement" && record.stage !== "retained_use") continue;
      if (!record.receiptDigest) continue;
      if (record.schemaVersion === FORWARD_SCHEMA) {
        if (legacyDeliveryReceipts.size > 0 && !legacyDeliveryReceipts.has(record.receiptDigest)) quarantine.push("wrong_receipt");
      } else if (!schemaDeliveryReceipts.has(record.receiptDigest)) quarantine.push("wrong_receipt");
    }
    const byRef = new Map();
    for (const record of op.records.filter(isAdmittedSettlement)) {
      const key = settlementIdentity(record);
      const current = byRef.get(key) || [];
      current.push(record);
      byRef.set(key, current);
    }
    let duplicateSettlementRecords = 0;
    for (const [reference, rows] of byRef) {
      if (reference === pin.movementRef || rows.some((row) => row.settlementReference === pin.movementRef)) {
        quarantine.push("closed_sponsored_expense");
        continue;
      }
      const amounts = new Set(rows.map((row) => row.valueAtomic));
      const receipts = new Set(rows.map((row) => row.receiptDigest));
      if (amounts.size > 1 || receipts.size > 1) quarantine.push("repeated_settlement_conflict");
      if (rows.length > 1 && amounts.size === 1 && receipts.size === 1) duplicateSettlementRecords += rows.length - 1;
    }
    const admittedRefs = [...byRef.keys()].filter((reference) => reference !== pin.movementRef);
    if (admittedRefs.length > 1) quarantine.push("repeated_settlement");
    const uniqueQuarantine = [...new Set(quarantine)].sort();
    // Legacy markers remain visible history, but cannot complete a v2 journey.
    const canonicalStages = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
    for (const record of op.records) {
      if (!isForwardV2(record)) continue;
      const stage = admittedStage(record);
      if (stage) canonicalStages[stage] += 1;
    }
    const missingStages = STAGES.filter((stage) => canonicalStages[stage] === 0);
    const secondUseAfterCorrection = op.records.some((record) => (
      isAdmittedReuse(record)
      && record.correctionOf === op.operationId
      && schemaDeliveryReceipts.has(record.receiptDigest)
    ));
    const canonicalStageJoin = uniqueQuarantine.length === 0
      && missingStages.length === 0
      && admittedRefs.length === 1
      && schemaDeliveryReceipts.size > 0;
    const admittedReuse = op.records.some(isAdmittedReuse);
    finished.push({
      operationId: op.operationId,
      brand: op.brands.size === 1 ? [...op.brands][0] : null,
      cohort: op.cohorts.size === 1 ? [...op.cohorts][0] : null,
      canonicalStageJoin,
      schemaValidDelivery: schemaDeliveryReceipts.size > 0,
      stages: op.stageCounts,
      canonicalStages,
      missingStages,
      settlementCount: uniqueQuarantine.length === 0 ? admittedRefs.length : 0,
      duplicateSettlementRecords,
      secondUseAfterCorrection: canonicalStageJoin ? secondUseAfterCorrection : false,
      quarantine: uniqueQuarantine,
      receiptDigests: [...new Set(op.records.map((record) => record.receiptDigest).filter(Boolean))].sort(),
      settlementReferences: [...new Set(op.records.map((record) => record.settlementReference).filter(Boolean))].sort(),
      recognizedRevenueAtomic: "0",
      organicAttribution: false,
      externalDemandProved: false,
      buyerAttestedUsefulness: false,
      retainedUseAuthority: admittedReuse ? "authenticated_producer_observation" : "absent",
      secondPay: false,
    });
  }
  return finished;
}

function projectHistorical(events, evidenceById, rareById) {
  const observations = [];
  const actorGroups = new Map();
  let unvalidatedResponseDigests = 0;
  for (const event of events) {
    const ids = actorGroups.get(event.actor) || [];
    ids.push(event.id);
    actorGroups.set(event.actor, ids);
    const evidence = evidenceById.get(event.id) || null;
    const rare = rareById.get(event.id) || null;
    const planes = ["commerce_event_v3"];
    if (evidence) planes.push("paid_success_evidence_v1");
    if (rare) planes.push("rare_funnel_v1");
    if (evidence?.responseDigest) unvalidatedResponseDigests += 1;
    observations.push({
      eventId: event.id,
      cohort: cohortFor(event.originClass, evidence?.payerClass || null),
      originClass: event.originClass,
      payerClass: evidence?.payerClass || null,
      stages: stagesForEvent(event),
      settlementReference: event.settlementReference,
      canonicalJoin: false,
      deliveryEstablished: false,
      retainedUse: "unknown",
      validatorAuthority: evidence ? "none" : null,
      sourcePlanes: planes,
    });
  }
  observations.sort((left, right) => left.eventId.localeCompare(right.eventId));
  const ignoredSharedActorGroups = [...actorGroups.values()].filter((ids) => new Set(ids).size > 1).length;
  return { observations, ignoredSharedActorGroups, unvalidatedResponseDigests };
}

function customerPlane(value) {
  const plane = value?.paymentEvidence?.customerPlane;
  if (!plane || typeof plane !== "object") return null;
  const keys = ["attributableCustomerCount", "buyerValidDeliveryCount", "repeatIndependentCustomerCount"];
  for (const key of keys) {
    if (plane[key] !== null) fail("aggregate_customer_plane");
  }
  return {
    attributableCustomerCount: null,
    buyerValidDeliveryCount: null,
    repeatIndependentCustomerCount: null,
  };
}

function classCounts(byClass) {
  if (!byClass || typeof byClass !== "object" || Array.isArray(byClass)) return [];
  return Object.entries(byClass).map(([name, row]) => ({
    class: name,
    settlements: Number.isInteger(row?.settlements) && row.settlements >= 0 ? row.settlements : null,
  })).sort((left, right) => left.class.localeCompare(right.class));
}

function nonNegative(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function projectPopulation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    events: nonNegative(value.events),
    paidSuccesses: nonNegative(value.paidSuccesses),
    constructedChallenges: nonNegative(value.constructedChallenges),
    credentialAttempts: nonNegative(value.credentialAttempts),
    paymentHeaderEvents: nonNegative(value.paymentHeaderEvents),
    paidSuccessEvents: nonNegative(value.paidSuccessEvents),
    verification: value.verification === "verified_internal_token" || value.verification === "unverified"
      ? value.verification
      : "unknown",
    provedOutsideDemand: false,
    independentDemand: false,
  };
}

function projectTrafficProvenance(value) {
  const populations = value?.populations;
  if (!value || typeof value !== "object" || Array.isArray(value) || !populations || typeof populations !== "object") {
    return {
      status: "unknown",
      reason: "producer_traffic_provenance_absent_external_events_are_not_an_outside_customer_census",
      historicalBackfill: false,
    };
  }
  return {
    status: "present",
    historicalBackfill: false,
    unattributedIsNotIndependent: value.unattributedIsNotIndependent === true,
    selfReportedGrantsTrust: false,
    verifiedInternal: projectPopulation(populations.verifiedInternal),
    selfReportedOwnerMonitor: projectPopulation(populations.selfReportedOwnerMonitor),
    scanner: projectPopulation(populations.scanner),
    crawler: projectPopulation(populations.crawler),
    unattributedExternal: projectPopulation(populations.unattributedExternal),
  };
}

function projectRareOriginPopulations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "unknown",
      reason: "producer_origin_split_absent_do_not_read_paid_success_as_outside_demand",
      historicalBackfill: false,
    };
  }
  return {
    status: "present",
    historicalBackfill: false,
    unattributedIsNotIndependent: value.unattributedIsNotIndependent === true,
    selfReportedGrantsTrust: false,
    verifiedInternal: projectPopulation(value.verifiedInternal),
    selfReportedOwnerMonitor: projectPopulation(value.selfReportedOwnerMonitor),
    unattributedExternal: projectPopulation(value.unattributedExternal),
    otherRetained: projectPopulation(value.otherRetained),
  };
}

export function projectPublicAggregate(document, meta) {
  if (!isPublicAggregate(document)) fail("public_aggregate_rejected");
  if (claimsRevenue(document)) fail("revenue_claim");
  if (containsRestrictedKey(document)) fail("restricted_fields");
  const plane = customerPlane(document);
  const settlement = document.paymentEvidence?.settlementPlane || {};
  const rare = document.durableRareFunnel?.boundaries || {};
  const byResult = {};
  for (const key of ["discovery", "protocol_discovery", "challenge", "paid_success", "validation_failure"]) {
    const count = document.byResult?.[key];
    if (Number.isInteger(count) && count >= 0) byResult[key] = count;
  }
  const aggregate = {
    generatedAt: typeof document.generatedAt === "string" ? document.generatedAt : null,
    requestedWindowComplete: document.requestedWindowComplete === true,
    requestedWindowCoverage: document.requestedWindowCoverage === "complete" ? "complete" : "unknown_for_full_window",
    externalEvents: Number.isInteger(document.externalEvents) ? document.externalEvents : null,
    retainedParseableEventCount: Number.isInteger(document.retainedParseableEventCount) ? document.retainedParseableEventCount : null,
    paidSuccessActors: Number.isInteger(document.paidSuccessActors) ? document.paidSuccessActors : null,
    independentPaidSuccessActors: Number.isInteger(document.independentPaidSuccessActors) ? document.independentPaidSuccessActors : null,
    byResult,
    paymentEvidenceSchema: document.paymentEvidence?.schemaVersion === PAYMENT_EVIDENCE_SCHEMA ? PAYMENT_EVIDENCE_SCHEMA : null,
    relationship: typeof document.paymentEvidence?.relationship === "string" ? document.paymentEvidence.relationship : null,
    reconciledSettlements: Number.isInteger(settlement.reconciledSettlements) ? settlement.reconciledSettlements : null,
    settlementAmountAtomic: atomic(settlement.amountAtomic),
    settlementAmountIsRevenue: false,
    settlementClasses: classCounts(settlement.byClass),
    customerPlane: plane,
    trafficProvenance: projectTrafficProvenance(document.trafficProvenance),
    rareOriginPopulations: projectRareOriginPopulations(document.durableRareFunnel?.originPopulations),
    usefulnessRemainsUnknown: rare.usefulnessRemainsUnknownWithoutSeparateAuthority === true,
    actorHashIsNotIdentity: rare.actorHashNotIndependentIdentity === true,
    individualJoin: false,
  };
  return assemble({
    decision: "aggregate",
    source: meta,
    historical: emptyHistorical(),
    operations: [],
    aggregate,
    unusable: emptyUnusable(),
    labels: emptyLabels(),
  });
}

function emptyHistorical() {
  return {
    records: 0,
    observations: [],
    ignoredSharedActorGroups: 0,
    unvalidatedResponseDigests: 0,
    retainedUse: "unknown",
    canonicalJoin: false,
  };
}

function emptyUnusable() {
  return { count: 0, reasons: {} };
}

function bumpReason(unusable, reason) {
  unusable.count += 1;
  unusable.reasons[reason] = (unusable.reasons[reason] || 0) + 1;
}

function missingEvidence(receipt) {
  const operations = receipt.forward.operations;
  const missing = [];
  if (receipt.decision === "aggregate" || receipt.aggregate) {
    missing.push("individual_event_identity", "customer_plane");
  }
  if (receipt.historical.records > 0) {
    missing.push("operation_id", "discovery_to_call_binding", "validated_delivery", "retained_use");
  }
  if (operations.length === 0) missing.push("forward_operation_binding");
  if (operations.some((op) => op.missingStages.includes("delivery") && op.stages.settlement > 0)) {
    missing.push("delivery_after_settlement");
  }
  if (operations.some((op) => op.missingStages.includes("call"))) missing.push("lost_call");
  missing.push("buyer_attestation", "treasury_inflow_binding");
  return [...new Set(missing)].sort();
}

function reportLines(receipt) {
  const lines = [
    "Recognized revenue is 0.",
    "Organic attribution is unestablished.",
    "The closed sponsored evaluation expense remains 200000 atomic base units. secondPay is false.",
    "An unrelated low-cost distribution experiment sits outside this missing historical join. Service remains closed.",
  ];
  if (receipt.decision === "aggregate" && receipt.aggregate) {
    const agg = receipt.aggregate;
    lines.push(
      `The public commerce-demand document is an aggregate. Window coverage is ${agg.requestedWindowCoverage}. Reconciled settlements in that aggregate: ${agg.reconciledSettlements ?? "unknown"}. Retained paid-success actors: ${agg.paidSuccessActors ?? "unknown"}. Customer counts are null. An individual discovery, call, delivery, settlement, and retained-use join is unproved.`,
    );
    lines.push("The aggregate relationship label is a coverage description. It is not customer revenue.");
  }
  if (receipt.historical.records > 0) {
    lines.push(
      `The producer export has ${receipt.historical.records} commerce events. Shared actor hashes were ignored in ${receipt.historical.ignoredSharedActorGroups} ${receipt.historical.ignoredSharedActorGroups === 1 ? "group" : "groups"}. Retained-use usefulness is unknown. Paid-success validator authority on this export is none. A response digest here leaves delivery unestablished.`,
    );
    lines.push("Discovery and a later paid call stay separate records. The actor hash is an IP and user-agent continuity key and is not an identity.");
  }
  for (const op of receipt.forward.operations) {
    if (op.canonicalStageJoin && op.cohort === "controlled_test") {
      lines.push(
        `Operation ${op.operationId} is a controlled evidence join. Discovery, call, schema-valid delivery, settlement, and retained use bind on that operation id and receipt. Buyer attestation is absent. Retained-use authority is an authenticated producer observation. This join is not external customer demand.`,
      );
    } else if (op.canonicalStageJoin) {
      lines.push(
        `Operation ${op.operationId} is ${op.cohort}. The five stages bind only inside that labeled cohort. Organic customer demand is unproved.`,
      );
    }
    if (op.canonicalStageJoin && op.secondUseAfterCorrection) {
      lines.push(`Operation ${op.operationId} records a later retained use after correction. That use adds no settlement and leaves secondPay false.`);
    }
    if (op.canonicalStageJoin && op.duplicateSettlementRecords > 0) {
      lines.push(`Operation ${op.operationId} repeated one settlement record ${op.duplicateSettlementRecords + 1} times. It counts once.`);
    }
    if (!op.canonicalStageJoin && op.quarantine.includes("closed_sponsored_expense")) {
      lines.push(`Operation ${op.operationId} cites the closed sponsored expense. It stays closed and is not a second payment.`);
    } else if (!op.canonicalStageJoin && op.quarantine.includes("legacy_unvalidated_evidence")) {
      lines.push(`Operation ${op.operationId} has forward labels without schema-valid HTTP delivery. A paid success and a response digest are not validated delivery.`);
    } else if (!op.canonicalStageJoin && op.stages.settlement > 0 && op.stages.delivery === 0) {
      lines.push(`Operation ${op.operationId} has a settlement and no delivery. Useful delivery is unestablished.`);
    } else if (!op.canonicalStageJoin && op.quarantine.length > 0) {
      lines.push(`Operation ${op.operationId} is quarantined (${op.quarantine.join(", ")}).`);
    } else if (!op.canonicalStageJoin && op.missingStages.length > 0) {
      lines.push(`Operation ${op.operationId} is missing ${op.missingStages.join(", ")}.`);
    }
  }
  if (receipt.forward.operations.every((op) => op.canonicalStageJoin === false)) {
    lines.push("No imported row establishes the five-stage join.");
  }
  lines.push("Historical commerce events at the inspected producer commit have no operation id. A forward instrumenter is required before the next experiment can be attributed. This receipt does not write that instrumenter.");
  return lines;
}

function assemble({ decision, source, historical, operations, aggregate, unusable, labels }) {
  const sponsoredExpense = loadPin();
  const receipt = {
    schema: BINDING_SCHEMA,
    jobId: BINDING_JOB_ID,
    operationId: OPERATION_ID,
    attemptOf: BINDING_ATTEMPT_OF,
    decision,
    source,
    inspectedProducerCommit: PRODUCER_COMMIT,
    recognizedRevenueAtomic: "0",
    organicAttribution: false,
    secondPay: false,
    merchantWrite: false,
    paidDemand: false,
    traffic: false,
    individualJoin: operations.some((op) => op.canonicalStageJoin),
    controlledEvidenceJoin: operations.some((op) => op.canonicalStageJoin && op.cohort === "controlled_test"),
    externalDemandProved: false,
    historicalCanonicalJoin: false,
    inputOrderIgnored: true,
    sponsoredExpense,
    labels,
    historical,
    forward: { operations },
    aggregate,
    unusable,
    missingEvidence: [],
    forwardInstrumentation: {
      requiredForHistoricalJoins: true,
      contract: FORWARD_SCHEMA_V2,
      readableLegacyContract: FORWARD_SCHEMA,
      producerCommit: PRODUCER_COMMIT,
      writerId: FORWARD_WRITER_ID,
      deliveryRule: "schema_valid_full_bounded_capture_only",
      plan: "tools/ops/three-site-settlement-join/measure/FORWARD-INSTRUMENTER.md",
    },
    conclusion: {
      historicalCanonicalJoin: false,
      recognizedRevenueAtomic: "0",
      organicAttribution: false,
      service: "closed",
      unrelatedLowCostDistributionExperiments: "outside_this_missing_historical_join",
      h15SponsoredExpense: "untouched",
    },
    report: [],
  };
  receipt.missingEvidence = missingEvidence(receipt);
  receipt.report = reportLines(receipt);
  return receipt;
}

function sourceMeta(partial) {
  return {
    kind: partial.kind,
    path: partial.path,
    sha256: partial.sha256,
    bytes: partial.bytes,
    producerCommit: PRODUCER_COMMIT,
    publicAggregateUrl: partial.publicAggregateUrl || null,
    admittedAsDemand: false,
  };
}

export function importOutcomeText(text, meta) {
  const parsed = parseDocument(text);
  if (parsed.kind === "aggregate") return projectPublicAggregate(parsed.document, sourceMeta(meta));
  if (parsed.kind === "wrong_schema") fail("wrong_source_schema");
  const labels = emptyLabels();
  const unusable = emptyUnusable();
  const events = [];
  const evidence = [];
  const rare = [];
  const forward = [];
  for (const record of parsed.records) {
    if (record === null) {
      bumpReason(unusable, "json");
      continue;
    }
    if (isV3(record)) events.push(record);
    else if (isPaidEvidence(record)) evidence.push(record);
    else if (isRare(record)) rare.push(record);
    else if (isForwardV2(record) || isForward(record)) forward.push(record);
    else if (record && record.v === 4 && record.revenue === false && record.demand === false && record.independentUse === false) {
      bumpReason(unusable, "mcp_typed_not_a_journey");
    } else bumpReason(unusable, "shape");
  }
  const evidenceById = new Map();
  for (const row of evidence) {
    if (evidenceById.has(row.id)) bumpReason(unusable, "duplicate_paid_evidence");
    else evidenceById.set(row.id, row);
  }
  const rareById = new Map();
  for (const row of rare) {
    if (!rareById.has(row.id)) rareById.set(row.id, row);
  }
  const historicalProjection = projectHistorical(events, evidenceById, rareById);
  for (const observation of historicalProjection.observations) bump(labels, observation.cohort);
  const ops = new Map();
  const seenForward = new Set();
  for (const record of forward) {
    if (seenForward.has(record.eventId)) {
      bumpReason(unusable, "duplicate_forward_event");
      continue;
    }
    seenForward.add(record.eventId);
    const op = ops.get(record.operationId) || blankOp(record.operationId);
    op.records.push(record);
    op.brands.add(record.brand);
    op.cohorts.add(record.cohort);
    const admitted = admittedStage(record);
    if (admitted) op.stageCounts[admitted] += 1;
    ops.set(record.operationId, op);
  }
  const pin = loadPin();
  const operations = finishOperations(ops, pin);
  for (const op of operations) {
    if (op.cohort) bump(labels, op.cohort);
  }
  for (const row of evidence) {
    if (!events.some((event) => event.id === row.id)) bumpReason(unusable, "unbound_paid_evidence");
  }
  return assemble({
    decision: "imported",
    source: sourceMeta(meta),
    historical: {
      records: events.length,
      observations: historicalProjection.observations,
      ignoredSharedActorGroups: historicalProjection.ignoredSharedActorGroups,
      unvalidatedResponseDigests: historicalProjection.unvalidatedResponseDigests,
      retainedUse: "unknown",
      canonicalJoin: false,
    },
    operations,
    aggregate: null,
    unusable,
    labels,
  });
}

function classifyDocument(document) {
  if (Array.isArray(document)) {
    guardRecords(document);
    return { kind: "records", records: document };
  }
  if (!document || typeof document !== "object") fail("invalid_source");
  if (claimsRevenue(document)) fail("revenue_claim");
  if (typeof document.schema === "string" && document.schema !== "pilot.s17.outcome-binding-import.v1") {
    return { kind: "wrong_schema" };
  }
  if (containsRestrictedKey(document)) fail("restricted_fields");
  if (isPublicAggregate(document)) return { kind: "aggregate", document };
  if (document.schema === "pilot.s17.outcome-binding-import.v1" && Array.isArray(document.records)) {
    guardRecords(document.records);
    return { kind: "records", records: document.records };
  }
  if (isV3(document) || isPaidEvidence(document) || isRare(document) || isForward(document) || isForwardV2(document)) {
    return { kind: "records", records: [document] };
  }
  return { kind: "wrong_schema" };
}

function guardRecords(records) {
  if (records.some((record) => record && containsRestrictedKey(record))) fail("restricted_fields");
  if (records.some((record) => record && claimsRevenue(record))) fail("revenue_claim");
}

function parseDocument(text) {
  if (typeof text !== "string" || text.trim() === "") fail("invalid_source");
  const trimmed = text.trim();
  let document;
  try {
    document = JSON.parse(trimmed);
  } catch {
    document = undefined;
  }
  if (document && typeof document === "object") return classifyDocument(document);
  const records = [];
  for (const line of trimmed.split(/\n/).map((line) => line.trim()).filter(Boolean)) {
    try {
      records.push(JSON.parse(line));
    } catch {
      records.push(null);
    }
  }
  guardRecords(records);
  return { kind: "records", records };
}

export function formatMarkdown(receipt) {
  const lines = ["# Outcome binding", "", ...receipt.report.map((line) => `- ${line}`), ""];
  lines.push(`Decision: ${receipt.decision}. Individual join: ${receipt.individualJoin}. Recognized revenue atomic: ${receipt.recognizedRevenueAtomic}.`);
  lines.push("");
  return `${lines.join("\n")}`;
}

export function allowedPublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (`${url.origin}${url.pathname}` !== PUBLIC_AGGREGATE_URL) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length === 0) return url.toString();
  if (keys.length === 1 && keys[0] === "days") {
    const days = url.searchParams.get("days");
    const number = Number(days);
    if (Number.isInteger(number) && number >= 1 && number <= 365 && String(number) === days) return url.toString();
  }
  return null;
}

export async function fetchPublicAggregate(url = PUBLIC_AGGREGATE_URL) {
  const allowed = allowedPublicUrl(url);
  if (!allowed) fail("public_aggregate_rejected");
  let response;
  try {
    response = await fetch(allowed, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    fail("public_aggregate_unavailable");
  }
  if (!response.ok) fail("public_aggregate_unavailable");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_FETCH_BYTES) fail("public_aggregate_rejected");
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail("public_aggregate_unavailable");
  }
  return projectPublicAggregate(document, sourceMeta({
    kind: "public_aggregate",
    path: allowed,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    publicAggregateUrl: allowed,
  }));
}

export function rejectBinding(code) {
  return {
    schema: BINDING_SCHEMA,
    jobId: BINDING_JOB_ID,
    operationId: OPERATION_ID,
    attemptOf: BINDING_ATTEMPT_OF,
    decision: "reject",
    reason: code,
    message: MESSAGES[code] || MESSAGES.invalid_source,
    recognizedRevenueAtomic: "0",
    organicAttribution: false,
    secondPay: false,
    merchantWrite: false,
    paidDemand: false,
    traffic: false,
    individualJoin: false,
    nextDecision: null,
  };
}
