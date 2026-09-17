import { BOUNDARY, OUTCOMES, PAYMENT_META_KEYS, REJECTION_KINDS } from "./constants.mjs";
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

function hasPaymentMeta(value) {
  if (!isPlainObject(value)) return false;
  return PAYMENT_META_KEYS.some((key) => Object.hasOwn(value, key) && value[key] != null);
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

function isPaymentRequired(body) {
  return Boolean(
    body
    && Number.isInteger(body.x402Version)
    && Array.isArray(body.accepts),
  );
}

/**
 * Classify an OpenAI Agents MCP callToolResult (or a JSON-RPC envelope).
 * Unpaid x402 is a *result* with isError:true, never a protocol error, never paid.
 */
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

  if (hasPaymentMeta(requestMeta) || hasPaymentMeta(envelope._meta)) {
    const attached = hasPaymentMeta(requestMeta) ? "request _meta" : "result _meta";
    fail(
      `Payment metadata in ${attached} is outside this unpaid example. Do not attach x402/payment or treat settlement evidence as unpaid isError.`,
      { kind: hasPaymentMeta(requestMeta) ? REJECTION_KINDS.PAYMENT_ATTACHED : REJECTION_KINDS.SETTLEMENT_EVIDENCE },
    );
  }

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

  const body = paymentRequiredBody(envelope);
  if (!isPaymentRequired(body)) {
    fail(
      "isError:true without PaymentRequired structuredContent (x402Version + accepts) is not an unpaid x402 challenge.",
      { kind: REJECTION_KINDS.MISSING_PAYMENT_REQUIRED },
    );
  }
  if (body.accepts.length === 0) {
    fail("PaymentRequired accepts must contain at least one option", {
      kind: REJECTION_KINDS.EMPTY_ACCEPTS,
    });
  }

  const accepts = body.accepts.map((item) => {
    if (!isPlainObject(item)) return { scheme: null, network: null, amount: null };
    return {
      scheme: typeof item.scheme === "string" ? item.scheme : null,
      network: typeof item.network === "string" ? item.network : null,
      amount: typeof item.amount === "string" || typeof item.amount === "number" ? String(item.amount) : null,
    };
  });

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
      acceptCount: body.accepts.length,
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
  return classifyUnpaidCall({
    result: fixture.result ?? fixture,
    requestMeta: fixture.requestMeta ?? fixture.params?._meta ?? null,
    jsonrpc: fixture.jsonrpc === "2.0" ? fixture : fixture.jsonrpcEnvelope ?? null,
    source: fixture.source ?? "fixture",
    toolName: fixture.toolName ?? fixture.params?.name ?? null,
    args: fixture.args ?? fixture.params?.arguments ?? null,
    sdkMethod: fixture.sdkMethod ?? SDK_METHOD,
  });
}
