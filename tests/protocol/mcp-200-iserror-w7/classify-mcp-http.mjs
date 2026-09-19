export const SCHEMA = "samedaydesk.protocol.mcp-200-iserror-w7.v1";
export const REJECT_CODE = "mcp_200_iserror_must_not_be_paid";

export const KIND = Object.freeze({
  APPLICATION_ERROR: "application_error",
  CHALLENGE: "challenge",
  HTTP_NON_SUCCESS: "http_non_success",
  JSONRPC_ERROR: "jsonrpc_error",
  MALFORMED: "malformed",
  PAID_SUCCESS: "paid_success",
  SETTLEMENT_FAILURE: "settlement_failure",
  UNSETTLED_TOOL_RESULT: "unsettled_tool_result",
});

const PAYMENT_LOOKS = /x402\/payment|PAYMENT-SIGNATURE|Payment Required/i;

export function decodeMcpHttpBody(body, contentType = "") {
  if (body == null) return null;
  if (typeof body === "object" && !Buffer.isBuffer(body) && !ArrayBuffer.isView(body)) {
    return body;
  }
  const text = Buffer.isBuffer(body) || ArrayBuffer.isView(body)
    ? Buffer.from(body).toString("utf8")
    : String(body);
  if (!text) return null;
  const sse = String(contentType || "").includes("text/event-stream") || /^\s*event:/m.test(text) || /^\s*data:/m.test(text);
  const payload = sse
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("")
    : text;
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function isJsonRpcObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mcpResultIsError(result) {
  return isJsonRpcObject(result) && result.isError === true;
}

function parseStructuredOrText(result) {
  if (!isJsonRpcObject(result)) return null;
  if (isJsonRpcObject(result.structuredContent)) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    const parsed = JSON.parse(text);
    return isJsonRpcObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isPaymentRequiredToolResult(result) {
  if (!mcpResultIsError(result)) return false;
  const body = parseStructuredOrText(result);
  return Boolean(body) && Number.isInteger(body.x402Version) && Array.isArray(body.accepts);
}

function settlementOf(result) {
  const meta = result?._meta;
  if (!isJsonRpcObject(meta)) return null;
  const proof = meta["x402/payment-response"];
  return isJsonRpcObject(proof) ? proof : null;
}

function decision(fields) {
  return {
    schemaVersion: SCHEMA,
    paid: false,
    kind: KIND.MALFORMED,
    reason: "unclassified",
    httpStatus: null,
    isError: false,
    jsonrpcError: false,
    ...fields,
  };
}

/**
 * Classify an observed MCP HTTP response. HTTP 2xx is the JSON-RPC envelope.
 * `result.isError === true` is never paid.
 */
export function classifyMcpHttpResponse({
  httpStatus,
  body,
  contentType = "",
  requestPaymentPresent = false,
} = {}) {
  const rpc = decodeMcpHttpBody(body, contentType);
  const result = isJsonRpcObject(rpc) && Object.hasOwn(rpc, "result") ? rpc.result : null;
  const isError = mcpResultIsError(result);
  const jsonrpcError = isJsonRpcObject(rpc) && Object.hasOwn(rpc, "error");
  const status = Number(httpStatus);

  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return decision({ kind: KIND.MALFORMED, reason: "invalid_http_status", isError, jsonrpcError });
  }

  if (status === 402) {
    return decision({
      httpStatus: status,
      isError,
      jsonrpcError,
      kind: KIND.CHALLENGE,
      reason: "http_402",
    });
  }

  if (status < 200 || status >= 300) {
    return decision({
      httpStatus: status,
      isError,
      jsonrpcError,
      kind: KIND.HTTP_NON_SUCCESS,
      reason: `http_${status}`,
    });
  }

  if (!isJsonRpcObject(rpc) || rpc.jsonrpc !== "2.0") {
    return decision({
      httpStatus: status,
      isError,
      jsonrpcError,
      kind: KIND.MALFORMED,
      reason: "not_jsonrpc_2_0",
    });
  }

  if (jsonrpcError) {
    return decision({
      httpStatus: status,
      isError: false,
      jsonrpcError: true,
      kind: KIND.JSONRPC_ERROR,
      reason: "jsonrpc_error",
    });
  }

  if (isError) {
    const settlement = settlementOf(result);
    if (isPaymentRequiredToolResult(result)) {
      return decision({
        httpStatus: status,
        isError: true,
        jsonrpcError: false,
        kind: KIND.CHALLENGE,
        reason: "mcp_iserror_payment_required",
      });
    }
    if (settlement && settlement.success === false) {
      return decision({
        httpStatus: status,
        isError: true,
        jsonrpcError: false,
        kind: KIND.SETTLEMENT_FAILURE,
        reason: "mcp_iserror_settlement_failed",
      });
    }
    return decision({
      httpStatus: status,
      isError: true,
      jsonrpcError: false,
      kind: KIND.APPLICATION_ERROR,
      reason: "mcp_iserror_not_paid",
    });
  }

  const settlement = settlementOf(result);
  if (requestPaymentPresent === true && settlement?.success === true && isJsonRpcObject(result)) {
    return decision({
      httpStatus: status,
      isError: false,
      jsonrpcError: false,
      paid: true,
      kind: KIND.PAID_SUCCESS,
      reason: "settled_tool_result",
    });
  }

  if (isJsonRpcObject(result)) {
    return decision({
      httpStatus: status,
      isError: false,
      jsonrpcError: false,
      kind: KIND.UNSETTLED_TOOL_RESULT,
      reason: "http_2xx_is_not_paid_without_settlement",
    });
  }

  return decision({
    httpStatus: status,
    isError: false,
    jsonrpcError: false,
    kind: KIND.MALFORMED,
    reason: "missing_tool_result",
  });
}

/**
 * The W7 invariant: HTTP 2xx + MCP `isError: true` cannot be paid.
 * Returns whether a paid claim against this observation must be rejected.
 */
export function rejectPaidClaimIfHttp200IsError(observation, claimed = {}) {
  const classified = classifyMcpHttpResponse(observation);
  const http2xx = Number.isInteger(classified.httpStatus)
    && classified.httpStatus >= 200
    && classified.httpStatus < 300;
  const claimsPaid = claimed.paid === true || claimed.result === "paid_success" || claimed.kind === KIND.PAID_SUCCESS;
  if (http2xx && classified.isError === true && (claimsPaid || classified.paid === true)) {
    return {
      rejected: true,
      code: REJECT_CODE,
      classified,
    };
  }
  if (classified.paid === true && classified.isError === true) {
    return {
      rejected: true,
      code: REJECT_CODE,
      classified,
    };
  }
  return { rejected: false, code: null, classified };
}

/**
 * Historical HTTP-envelope inference. Documented as incorrect for MCP.
 * `isError: true` on HTTP 2xx with a payment-looking body was treated as paid.
 */
export function naiveHttp2xxPaidInference({
  httpStatus,
  body,
  contentType = "",
  requestPaymentPresent = false,
  notification = false,
} = {}) {
  const rpc = decodeMcpHttpBody(body, contentType);
  const text = typeof body === "string" || Buffer.isBuffer(body)
    ? String(body)
    : JSON.stringify(body || {});
  const paymentPresent = requestPaymentPresent === true || PAYMENT_LOOKS.test(text);
  const status = Number(httpStatus);
  if (!Number.isInteger(status) || status < 200 || status >= 300) return "not_paid";
  if (notification) return paymentPresent ? "paid_success" : "not_paid";
  if (/isError"\s*:\s*true/.test(text) && paymentPresent) return "paid_success";
  if (mcpResultIsError(rpc?.result) && paymentPresent) return "paid_success";
  if (paymentPresent) return "paid_success";
  return "not_paid";
}

export function holdsMcp200IsErrorNeverPaid(observation) {
  const classified = classifyMcpHttpResponse(observation);
  const http2xx = Number.isInteger(classified.httpStatus)
    && classified.httpStatus >= 200
    && classified.httpStatus < 300;
  if (http2xx && classified.isError === true) {
    return classified.paid === false && classified.kind !== KIND.PAID_SUCCESS;
  }
  return true;
}
