const MCP_ERROR_PREFIX = /^MCP error (-?\d+):\s*/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textFromResult(result) {
  const structured = result?.structuredContent;
  if (isRecord(structured)) {
    const message = structured.error?.message || structured.error || structured.message;
    if (typeof message === "string" && message.length > 0) return message;
    try {
      return JSON.stringify(structured);
    } catch {
      // fall through
    }
  }
  const text = result?.content?.[0]?.text;
  return typeof text === "string" ? text : "";
}

function parseMcpErrorMessage(message) {
  const match = String(message || "").match(MCP_ERROR_PREFIX);
  if (!match) return null;
  return { code: Number(match[1]) };
}

function protocolRejection({ code, message, name }) {
  return {
    rejected: true,
    layer: "mcp-protocol",
    code: code ?? null,
    name: name ?? "McpError",
    message,
  };
}

function isPaymentRequired(value) {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.x402Version)) return false;
  if (!Array.isArray(value.accepts)) return false;
  return /payment required/i.test(String(value.error || ""));
}

function paymentRequiredFromResult(result) {
  if (isPaymentRequired(result?.structuredContent)) return result.structuredContent;
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return isPaymentRequired(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Classify a tools/call outcome. Negative fixtures require rejected=true.
 * Unknown tools must land on mcp-protocol (-32602), not x402-payment-required.
 */
export function classifyToolsCall(errorOrResult) {
  if (errorOrResult == null) {
    return { rejected: false, layer: "empty", code: null, message: "empty tools/call outcome" };
  }
  if (errorOrResult instanceof Error || errorOrResult?.name === "McpError") {
    const message = errorOrResult.message || String(errorOrResult);
    const parsed = parseMcpErrorMessage(message);
    return protocolRejection({
      code: errorOrResult.code ?? parsed?.code ?? null,
      message,
      name: errorOrResult.name ?? "Error",
    });
  }
  if (errorOrResult.isError === true) {
    const message = textFromResult(errorOrResult) || "tool result isError";
    const parsed = parseMcpErrorMessage(message);
    if (parsed) {
      return protocolRejection({ code: parsed.code, message });
    }
    const required = paymentRequiredFromResult(errorOrResult);
    if (required) {
      return {
        rejected: true,
        layer: "x402-payment-required",
        code: -32042,
        message,
        x402Version: required.x402Version,
      };
    }
    return {
      rejected: true,
      layer: "tool-result-isError",
      code: errorOrResult?.structuredContent?.error?.code ?? null,
      message,
    };
  }
  return {
    rejected: false,
    layer: "accepted",
    code: null,
    message: textFromResult(errorOrResult) || "tools/call succeeded",
  };
}

export function classifyJsonRpcResponse(json) {
  if (!isRecord(json)) {
    return { rejected: false, layer: "empty", code: null, message: "empty jsonrpc response" };
  }
  if (isRecord(json.error)) {
    const message = typeof json.error.message === "string" ? json.error.message : "jsonrpc error";
    const parsed = parseMcpErrorMessage(message);
    return protocolRejection({
      code: json.error.code ?? parsed?.code ?? null,
      message,
    });
  }
  return classifyToolsCall(json.result);
}

export function classifyRejectFixture(fixture) {
  const observation = classifyJsonRpcResponse(fixture?.response);
  const matchesReject = observation.rejected !== true && observation.layer === "accepted";
  return {
    id: fixture?.id ?? null,
    expect: fixture?.expect ?? null,
    rejectCode: fixture?.rejectCode ?? null,
    ok: fixture?.expect === "reject" ? matchesReject : false,
    verdict: observation.rejected ? "rejected" : "accepted",
    code: matchesReject ? (fixture?.rejectCode ?? "accepted") : observation.code,
    observation,
  };
}

export async function invokeToolsCall(client, { name, arguments: args, meta } = {}) {
  try {
    const request = { name, arguments: args ?? {} };
    if (meta && typeof meta === "object") request._meta = meta;
    const result = await client.callTool(request);
    return classifyToolsCall(result);
  } catch (error) {
    return classifyToolsCall(error);
  }
}
