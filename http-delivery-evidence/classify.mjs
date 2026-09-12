import {
  RESOURCES,
  MAX_RESPONSE_BYTES,
  boundCounter,
  checkDeclaredContract,
  contractNameForResource,
  isSupportedTarget,
  parseJsonBytes,
} from "./contract.mjs";

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

export const PROHIBITED_INFERENCES = Object.freeze([
  "http_200_is_useful_delivery",
  "nonempty_text_is_useful_delivery",
  "schema_pass_is_buyer_attested",
  "simulated_settlement_is_revenue",
  "not_checked_is_validated",
  "mcp_tool_is_http_buyer",
  "schema_shaped_http_500_is_completed_delivery",
  "truncate_class_hides_source_refusal",
]);

const ENGINE_CODES = new Set([
  "fetch_error",
  "redirect_error",
  "invalid_response",
  "ssrf_blocked",
]);

export function isCompletedMerchantHttp(status) {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

/**
 * Domain class of a parsed body after transport and schema layers have already
 * been applied. Prefer evaluateResponseBytes for HTTP evidence.
 */
export function classifyParsedBody({
  resource,
  parsed,
  contract,
  merchantHttpStatus = 200,
  oversized = false,
} = {}) {
  return classifyLayers({
    method: (resource === RESOURCES.EXTRACT_BATCH || resource === RESOURCES.LOCKFILE || resource === RESOURCES.VENDOR_BUDGET) ? "POST" : "GET",
    resource,
    parsed,
    contract,
    merchantHttpStatus,
    oversized,
  });
}

export function evaluateResponseBytes({
  method,
  resource,
  responseBytes,
  merchantHttpStatus,
  settlementClass,
  settlementReference = null,
  payerClass = "unclassified",
  capturedAt = new Date().toISOString(),
  recordId,
  responseByteLength,
} = {}) {
  const bytes = Buffer.isBuffer(responseBytes) || responseBytes instanceof Uint8Array
    ? Buffer.from(responseBytes)
    : Buffer.alloc(0);
  const actualLength = Number.isInteger(responseByteLength) ? responseByteLength : bytes.length;
  const oversized = actualLength > MAX_RESPONSE_BYTES;
  const parsed = parseJsonBytes(bytes.length > MAX_RESPONSE_BYTES ? bytes.subarray(0, MAX_RESPONSE_BYTES) : bytes);
  const contract = contractFor({ method, resource, parsed });
  const classified = classifyLayers({
    method,
    resource,
    parsed,
    contract,
    merchantHttpStatus,
    oversized,
  });
  return {
    schemaVersion: SCHEMA,
    contractName: contractNameForResource(resource),
    method,
    resource,
    merchantHttpStatus: Number.isInteger(merchantHttpStatus) ? merchantHttpStatus : null,
    settlementClass,
    settlementReference,
    payerClass,
    capturedAt,
    recordId,
    bytesLength: actualLength,
    storedByteLength: Math.min(bytes.length, MAX_RESPONSE_BYTES),
    parsed,
    contract,
    ...classified,
  };
}

function contractFor({ method, resource, parsed }) {
  if (!isSupportedTarget(method, resource)) {
    return {
      ok: false,
      unsupported: true,
      schemaErrors: 0,
      requiredPresent: 0,
      codes: [resource && method ? "unsupported_target" : "unsupported_target"],
    };
  }
  if (!parsed.ok) {
    return {
      ok: false,
      schemaErrors: parsed.reason === "missing_body" ? 0 : 1,
      requiredPresent: 0,
      codes: [parsed.reason || "missing_body"],
    };
  }
  return checkDeclaredContract(resource, parsed.value, method);
}

function classifyLayers({
  method,
  resource,
  parsed,
  contract,
  merchantHttpStatus,
  oversized,
}) {
  const truncateMarks = boundCounter(
    (parsed.ok ? truncateMarksOf(parsed.value, resource) : 0) + (oversized ? 1 : 0),
  );
  const sourceRefusalMarks = boundCounter(
    parsed.ok && parsed.value?.sourceOk === false ? 1 : 0,
  );

  if (!isSupportedTarget(method, resource)) {
    return wrap({
      verdict: VERDICT.UNKNOWN,
      deliveryClass: DELIVERY.UNSUPPORTED_TARGET,
      contract,
      truncateMarks,
      sourceRefusalMarks: 0,
      schemaConformance: SCHEMA_CONFORMANCE.NOT_APPLICABLE,
    });
  }

  if (!parsed.ok && parsed.reason === "missing_body") {
    return wrap({
      verdict: VERDICT.UNKNOWN,
      deliveryClass: DELIVERY.MISSING_BODY,
      contract,
      truncateMarks,
      sourceRefusalMarks: 0,
      schemaConformance: SCHEMA_CONFORMANCE.NOT_APPLICABLE,
    });
  }
  if (!parsed.ok) {
    return wrap({
      verdict: VERDICT.INVALID,
      deliveryClass: DELIVERY.MALFORMED_BODY,
      contract,
      truncateMarks,
      sourceRefusalMarks: 0,
      schemaConformance: SCHEMA_CONFORMANCE.NOT_APPLICABLE,
    });
  }

  const body = parsed.value;
  const schemaConformance = contract.ok
    ? SCHEMA_CONFORMANCE.HOLDS
    : SCHEMA_CONFORMANCE.FAILS;

  if (!isCompletedMerchantHttp(merchantHttpStatus)) {
    return wrap({
      verdict: VERDICT.INVALID,
      deliveryClass: DELIVERY.MERCHANT_HTTP_FAILURE,
      contract,
      truncateMarks,
      sourceRefusalMarks,
      schemaConformance,
    });
  }

  const typedFailure = typedFailureDelivery(body);
  if (typedFailure) {
    return wrap({
      verdict: VERDICT.INVALID,
      deliveryClass: typedFailure,
      contract,
      truncateMarks,
      sourceRefusalMarks,
      schemaConformance: SCHEMA_CONFORMANCE.FAILS,
    });
  }

  if (!contract.ok) {
    return wrap({
      verdict: VERDICT.INVALID,
      deliveryClass: DELIVERY.MALFORMED_BODY,
      contract,
      truncateMarks,
      sourceRefusalMarks,
      schemaConformance: SCHEMA_CONFORMANCE.FAILS,
    });
  }

  if (resource === RESOURCES.EXTRACT_BATCH) {
    if (body.ok === true && body.partial === false && truncateMarks === 0) {
      return wrap({
        verdict: VERDICT.PASS,
        deliveryClass: DELIVERY.FULL_BOUNDED_CAPTURE,
        contract,
        truncateMarks,
        sourceRefusalMarks: 0,
        schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
      });
    }
    return wrap({
      verdict: VERDICT.PASS,
      deliveryClass: DELIVERY.TRUNCATED_PARTIAL,
      contract,
      truncateMarks: boundCounter(Math.max(truncateMarks, body.partial === true ? 1 : truncateMarks)),
      sourceRefusalMarks: 0,
      schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
    });
  }

  if (resource === RESOURCES.LOCKFILE || resource === RESOURCES.VENDOR_BUDGET) {
    if (body.transport === "timeout") {
      return wrap({
        verdict: VERDICT.INVALID,
        deliveryClass: DELIVERY.TRANSPORT_FAILURE,
        contract,
        truncateMarks,
        sourceRefusalMarks: 0,
        schemaConformance,
      });
    }
    if (body.transport && body.transport !== "ok") {
      return wrap({
        verdict: VERDICT.INVALID,
        deliveryClass: DELIVERY.ENGINE_FAILURE,
        contract,
        truncateMarks,
        sourceRefusalMarks: 0,
        schemaConformance,
      });
    }
    if (body.analysis === "partial") {
      return wrap({
        verdict: VERDICT.PASS,
        deliveryClass: DELIVERY.TRUNCATED_PARTIAL,
        contract,
        truncateMarks: boundCounter(Math.max(1, truncateMarks)),
        sourceRefusalMarks: 0,
        schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
      });
    }
    if (body.analysis === "actionable" || body.analysis === "informational") {
      return wrap({
        verdict: VERDICT.PASS,
        deliveryClass: DELIVERY.FULL_BOUNDED_CAPTURE,
        contract,
        truncateMarks: 0,
        sourceRefusalMarks: 0,
        schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
      });
    }
    return wrap({
      verdict: VERDICT.UNKNOWN,
      deliveryClass: DELIVERY.MALFORMED_BODY,
      contract,
      truncateMarks,
      sourceRefusalMarks: 0,
      schemaConformance,
    });
  }

  if (body.sourceOk === false) {
    return wrap({
      verdict: VERDICT.PASS,
      deliveryClass: DELIVERY.SOURCE_REFUSAL,
      contract,
      truncateMarks,
      sourceRefusalMarks: boundCounter(Math.max(1, sourceRefusalMarks)),
      schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
    });
  }

  if (truncateMarks > 0) {
    return wrap({
      verdict: VERDICT.PASS,
      deliveryClass: DELIVERY.TRUNCATED_PARTIAL,
      contract,
      truncateMarks,
      sourceRefusalMarks: 0,
      schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
    });
  }

  if (body.sourceOk === true) {
    return wrap({
      verdict: VERDICT.PASS,
      deliveryClass: DELIVERY.FULL_BOUNDED_CAPTURE,
      contract,
      truncateMarks: 0,
      sourceRefusalMarks: 0,
      schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
    });
  }

  return wrap({
    verdict: VERDICT.UNKNOWN,
    deliveryClass: DELIVERY.MALFORMED_BODY,
    contract,
    truncateMarks,
    sourceRefusalMarks,
    schemaConformance: SCHEMA_CONFORMANCE.HOLDS,
  });
}

function typedFailureDelivery(body) {
  if (!body || typeof body !== "object" || body.ok !== false) return null;
  const code = failureCodeOf(body);
  if (code === "unsupported_encoding") return DELIVERY.UNSUPPORTED_CONTENT;
  if (code === "timeout") return DELIVERY.TRANSPORT_FAILURE;
  if (ENGINE_CODES.has(code)) return DELIVERY.ENGINE_FAILURE;
  return null;
}

function failureCodeOf(body) {
  if (!body || typeof body !== "object") return null;
  if (body.error && typeof body.error === "object" && typeof body.error.code === "string") {
    return body.error.code;
  }
  if (typeof body.error === "string") return body.error;
  return null;
}

function truncateMarksOf(body, resource) {
  let marks = 0;
  const capture = body?.capture;
  if (capture?.bodyTruncated === true) marks += 1;
  if (capture?.textTruncated === true) marks += 1;
  if (body?.truncated === true) marks += 1;
  if (resource === RESOURCES.EXTRACT_BATCH && body?.partial === true) marks += 1;
  return boundCounter(marks);
}

function wrap({
  verdict,
  deliveryClass,
  contract,
  truncateMarks = 0,
  sourceRefusalMarks = 0,
  schemaConformance,
}) {
  return {
    validatorVerdict: verdict,
    validatorAuthority: VALIDATOR_AUTHORITY,
    validatorSource: VALIDATOR_SOURCE,
    deliveryClass,
    usefulness: USEFULNESS_UNKNOWN,
    schemaConformance,
    counters: {
      schemaErrors: boundCounter(contract.schemaErrors),
      requiredPresent: boundCounter(contract.requiredPresent),
      truncateMarks: boundCounter(truncateMarks),
      sourceRefusalMarks: boundCounter(sourceRefusalMarks),
    },
  };
}
