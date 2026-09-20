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

function parseJsonValue(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Streamable HTTP may emit several SSE events (ping, endpoint, message).
 * Joining every `data:` line produces invalid JSON and hid `result.isError`.
 * Parse each event; keep the last JSON-RPC response.
 */
function parseSseJsonRpc(text) {
  const events = [];
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    const parsed = parseJsonValue(dataLines.join("\n"));
    dataLines = [];
    if (parsed != null) events.push(parsed);
  };
  for (const line of String(text).split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  flush();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (isJsonRpcObject(event) && (Object.hasOwn(event, "result") || Object.hasOwn(event, "error"))) {
      return event;
    }
  }
  return events.length > 0 && isJsonRpcObject(events[events.length - 1])
    ? events[events.length - 1]
    : null;
}

export function decodeMcpHttpBody(body, contentType = "") {
  if (body == null) return null;
  if (typeof body === "object" && !Buffer.isBuffer(body) && !ArrayBuffer.isView(body)) {
    return body;
  }
  const text = Buffer.isBuffer(body) || ArrayBuffer.isView(body)
    ? Buffer.from(body).toString("utf8")
    : String(body);
  if (!text) return null;
  const direct = parseJsonValue(text);
  if (direct != null && (isJsonRpcObject(direct) || Array.isArray(direct))) return direct;
  const sse = String(contentType || "").includes("text/event-stream")
    || /^\s*(?:event|id|retry):/m.test(text)
    || /^\s*data:/m.test(text);
  if (sse) return parseSseJsonRpc(text);
  return null;
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

  // JSON-RPC forbids result+error together. If result.isError is present, never
  // treat the envelope as paid; do not let a sibling `error` drop isError.
  if (isError) {
    const settlement = settlementOf(result);
    if (isPaymentRequiredToolResult(result)) {
      return decision({
        httpStatus: status,
        isError: true,
        jsonrpcError,
        kind: KIND.CHALLENGE,
        reason: "mcp_iserror_payment_required",
      });
    }
    if (settlement && settlement.success === false) {
      return decision({
        httpStatus: status,
        isError: true,
        jsonrpcError,
        kind: KIND.SETTLEMENT_FAILURE,
        reason: "mcp_iserror_settlement_failed",
      });
    }
    return decision({
      httpStatus: status,
      isError: true,
      jsonrpcError,
      kind: KIND.APPLICATION_ERROR,
      reason: "mcp_iserror_not_paid",
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

  const settlement = settlementOf(result);
  // @x402/mcp attaches payment-response.success=false without setting isError
  // when settle() returns a failed SettleResponse instead of throwing.
  if (settlement && settlement.success === false && isJsonRpcObject(result)) {
    return decision({
      httpStatus: status,
      isError: false,
      jsonrpcError: false,
      kind: KIND.SETTLEMENT_FAILURE,
      reason: "mcp_settlement_failed",
    });
  }
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
  const rpc = decodeMcpHttpBody(observation?.body, observation?.contentType || "");
  const rawResult = isJsonRpcObject(rpc) && Object.hasOwn(rpc, "result") ? rpc.result : null;
  const rawIsError = mcpResultIsError(rawResult);
  const http2xx = Number.isInteger(classified.httpStatus)
    && classified.httpStatus >= 200
    && classified.httpStatus < 300;
  const claimsPaid = claimed.paid === true || claimed.result === "paid_success" || claimed.kind === KIND.PAID_SUCCESS;
  const isError = classified.isError === true || rawIsError;
  if (http2xx && isError && (claimsPaid || classified.paid === true)) {
    return {
      rejected: true,
      code: REJECT_CODE,
      classified: classified.isError === true ? classified : { ...classified, isError: true, paid: false },
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
  const rpc = decodeMcpHttpBody(observation?.body, observation?.contentType || "");
  const rawResult = isJsonRpcObject(rpc) && Object.hasOwn(rpc, "result") ? rpc.result : null;
  const isError = classified.isError === true || mcpResultIsError(rawResult);
  const http2xx = Number.isInteger(classified.httpStatus)
    && classified.httpStatus >= 200
    && classified.httpStatus < 300;
  if (http2xx && isError) {
    return classified.paid === false && classified.kind !== KIND.PAID_SUCCESS;
  }
  return true;
}
