const MCP_ERROR_PREFIX = /^MCP error (-?\d+):\s*/;
const PAYMENT_CODES = new Set([-32042, 402]);

function textFromUnknown(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseMcpErrorMessage(message) {
  const match = String(message || "").match(MCP_ERROR_PREFIX);
  if (!match) return null;
  return { code: Number(match[1]) };
}

export function isPaymentRequiredShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (PAYMENT_CODES.has(value.code) || PAYMENT_CODES.has(value.error?.code)) return true;
  const body = value.x402 || value.error?.data?.x402 || value.error?.data || value.data || value;
  if (!body || typeof body !== "object") return false;
  return Number.isInteger(body.x402Version) && Array.isArray(body.accepts);
}

export function classifyPaymentRequired(status, payload, headers = {}) {
  if (status === 402) {
    return { paymentRequired: true, reason: "HTTP 402" };
  }
  const header = headers["payment-required"] || headers["PAYMENT-REQUIRED"];
  if (typeof header === "string" && header.length > 0) {
    return { paymentRequired: true, reason: "Payment-Required header" };
  }
  if (isPaymentRequiredShape(payload) || isPaymentRequiredShape(payload?.error) || isPaymentRequiredShape(payload?.result)) {
    return { paymentRequired: true, reason: "x402 PaymentRequired body" };
  }
  return { paymentRequired: false, reason: null };
}

function protocolRejection({ code, message, name }) {
  return {
    rejected: true,
    layer: "mcp-protocol",
    code: code ?? null,
    name: name ?? "McpError",
    message,
    paymentRequired: PAYMENT_CODES.has(code),
  };
}

export function classifyPromptGet(errorOrResult) {
  if (errorOrResult == null) {
    return { rejected: false, layer: "empty", code: null, message: "empty prompts/get outcome" };
  }
  if (errorOrResult instanceof Error || errorOrResult?.name === "McpError") {
    const message = errorOrResult.message || String(errorOrResult);
    const parsed = parseMcpErrorMessage(message);
    const code = errorOrResult.code ?? parsed?.code ?? null;
    return protocolRejection({ code, message, name: errorOrResult.name ?? "Error" });
  }
  if (errorOrResult.error && typeof errorOrResult.error === "object") {
    const code = errorOrResult.error.code ?? null;
    const message = errorOrResult.error.message || textFromUnknown(errorOrResult.error);
    return protocolRejection({ code, message, name: "JsonRpcError" });
  }
  if (isPaymentRequiredShape(errorOrResult)) {
    return {
      rejected: true,
      layer: "payment-required",
      code: -32042,
      message: "prompts/get returned a payment challenge",
      paymentRequired: true,
    };
  }
  const messages = errorOrResult.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    return {
      rejected: false,
      layer: "accepted",
      code: null,
      message: "prompts/get returned messages",
      paymentRequired: false,
    };
  }
  return {
    rejected: false,
    layer: "accepted",
    code: null,
    message: textFromUnknown(errorOrResult) || "prompts/get succeeded",
    paymentRequired: false,
  };
}

export async function invokePromptGet(client, { name, arguments: args } = {}) {
  try {
    const result = await client.getPrompt({ name, arguments: args });
    return classifyPromptGet(result);
  } catch (error) {
    return classifyPromptGet(error);
  }
}
