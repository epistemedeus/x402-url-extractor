import { BOUNDARY, OUTCOMES, REJECTION_KINDS } from "./constants.mjs";
import { fail } from "./errors.mjs";
import {
  PRODUCT,
  SCHEMA_VERSION,
  SDK_CALLTOOL_METHOD,
  SDK_DOCS,
  SDK_METHOD,
  SDK_PACKAGE,
  SDK_VERSION,
} from "./pins.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function paymentMetaKind(value) {
  if (!isPlainObject(value)) return null;
  if (Object.hasOwn(value, "x402/payment") && value["x402/payment"] != null) {
    return REJECTION_KINDS.PAYMENT_ATTACHED;
  }
  if (Object.hasOwn(value, "x402/payment-response") && value["x402/payment-response"] != null) {
    return REJECTION_KINDS.SETTLEMENT_EVIDENCE;
  }
  return null;
}

function rejectPaymentMeta(value, where) {
  const kind = paymentMetaKind(value);
  if (!kind) return;
  fail(
    `Payment metadata in ${where} is outside this unpaid example. Do not attach x402/payment or treat settlement evidence as unpaid isError.`,
    { kind },
  );
}

function paymentRequiredBody(result) {
  if (!isPlainObject(result)) return null;
  if (isPlainObject(result.structuredContent)) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0 || text.length > 64 * 1024) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function assertContentMatchesStructured(envelope) {
  if (!isPlainObject(envelope.structuredContent)) return;
  const text = envelope.content?.[0]?.text;
  if (typeof text !== "string") return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("content text must be JSON matching structuredContent", {
      kind: REJECTION_KINDS.INVALID_SHAPE,
    });
  }
  if (JSON.stringify(parsed) !== JSON.stringify(envelope.structuredContent)) {
    fail("content text must match structuredContent", {
      kind: REJECTION_KINDS.INVALID_SHAPE,
    });
  }
}

function normalizeAccept(item) {
  if (!isPlainObject(item)) return null;
  const scheme = typeof item.scheme === "string" ? item.scheme.trim() : "";
  const network = typeof item.network === "string" ? item.network.trim() : "";
  const amount = typeof item.amount === "string" || typeof item.amount === "number"
    ? String(item.amount)
    : "";
  if (!scheme || !network || !amount) return null;
  return { scheme, network, amount };
}

export function classifyUnpaidCall({
  result,
  requestMeta = null,
  jsonrpc = null,
  source = "fixture",
  toolName = null,
  args = null,
  sdkMethod = SDK_METHOD,
} = {}) {
  if (jsonrpc && isPlainObject(jsonrpc.error)) {
    fail(
      "JSON-RPC protocol error is not an OpenAI Agents unpaid isError result. Payment required must be a tool result with isError:true.",
      { kind: REJECTION_KINDS.PROTOCOL_ERROR, details: { code: jsonrpc.error.code ?? null } },
    );
  }

  const envelope = isPlainObject(jsonrpc) && isPlainObject(jsonrpc.result) ? jsonrpc.result : result;
  if (!isPlainObject(envelope)) {
    fail("OpenAI Agents callToolResult must be an object", {
      kind: REJECTION_KINDS.INVALID_SHAPE,
    });
  }

  rejectPaymentMeta(requestMeta, "request _meta");
  rejectPaymentMeta(envelope._meta, "result _meta");
  rejectPaymentMeta(envelope.structuredContent, "structuredContent");

  const isErrorPreserved = Object.hasOwn(envelope, "isError");
  if (!isErrorPreserved) {
    fail(
      `${SDK_CALLTOOL_METHOD} returns content only and drops isError. Use ${SDK_METHOD} so unpaid PaymentRequired stays isError:true.`,
      { kind: REJECTION_KINDS.IS_ERROR_NOT_PRESERVED, details: { sdkDocs: SDK_DOCS } },
    );
  }

  if (envelope.isError !== true) {
    fail(
      "Unpaid OpenAI Agents MCP tools/call must be isError:true. isError:false is not a payment challenge and is not paid_success.",
      { kind: REJECTION_KINDS.IS_ERROR_NOT_TRUE, details: { isError: envelope.isError ?? null } },
    );
  }

  assertContentMatchesStructured(envelope);

  const body = paymentRequiredBody(envelope);
  if (!body || body.x402Version !== 2 || !Array.isArray(body.accepts)) {
    fail(
      "isError:true without PaymentRequired structuredContent (x402Version 2 + accepts) is not an unpaid x402 challenge.",
      { kind: REJECTION_KINDS.MISSING_PAYMENT_REQUIRED },
    );
  }
  rejectPaymentMeta(body, "PaymentRequired body");
  if (body.accepts.length === 0) {
    fail("PaymentRequired accepts must contain at least one option", {
      kind: REJECTION_KINDS.EMPTY_ACCEPTS,
    });
  }

  const accepts = [];
  for (const item of body.accepts) {
    const normalized = normalizeAccept(item);
    if (!normalized) {
      fail("PaymentRequired accepts entries must include scheme, network, and amount", {
        kind: REJECTION_KINDS.EMPTY_ACCEPTS,
      });
    }
    accepts.push(normalized);
  }

  return Object.freeze({
    ok: true,
    product: PRODUCT,
    schemaVersion: SCHEMA_VERSION,
    outcome: OUTCOMES.UNPAID_CALL_IS_ERROR,
    isError: true,
    kind: "payment_required",
    paid: false,
    charged: false,
    protocolError: false,
    liveMerchantCall: false,
    source,
    toolName,
    args,
    sdk: Object.freeze({
      package: SDK_PACKAGE,
      version: SDK_VERSION,
      method: sdkMethod,
      callToolDropsIsError: true,
    }),
    challenge: Object.freeze({
      x402Version: body.x402Version,
      acceptCount: accepts.length,
      accepts,
    }),
    boundary: BOUNDARY,
    result: Object.freeze({
      isError: true,
      hasStructuredContent: isPlainObject(envelope.structuredContent),
      contentCount: Array.isArray(envelope.content) ? envelope.content.length : 0,
    }),
  });
}

export function classifyFixture(fixture) {
  if (!isPlainObject(fixture)) {
    fail("fixture must be a JSON object", { kind: REJECTION_KINDS.INVALID_SHAPE });
  }
  const nested = isPlainObject(fixture.jsonrpcEnvelope) ? fixture.jsonrpcEnvelope : null;
  if (
    nested
    && isPlainObject(nested.result)
    && Object.hasOwn(fixture, "result")
    && fixture.jsonrpc !== "2.0"
    && JSON.stringify(fixture.result) !== JSON.stringify(nested.result)
  ) {
    fail("fixture result and jsonrpcEnvelope.result conflict", {
      kind: REJECTION_KINDS.INVALID_SHAPE,
    });
  }
  return classifyUnpaidCall({
    result: fixture.result ?? fixture,
    requestMeta: fixture.requestMeta ?? fixture.params?._meta ?? null,
    jsonrpc: fixture.jsonrpc === "2.0" ? fixture : nested,
    source: fixture.source ?? "fixture",
    toolName: fixture.toolName ?? fixture.params?.name ?? null,
    args: fixture.args ?? fixture.params?.arguments ?? null,
    sdkMethod: fixture.sdkMethod ?? SDK_METHOD,
  });
}
