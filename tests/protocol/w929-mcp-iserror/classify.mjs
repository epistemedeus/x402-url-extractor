import { FORBIDDEN_INVENTED, SDS } from "./constants.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function inventedHits(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  const hits = [];
  for (const name of FORBIDDEN_INVENTED) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`);
    if (re.test(text)) hits.push(name);
  }
  return hits;
}

function headerEntries(observation) {
  const names = [];
  const values = new Map();
  const headers = observation?.headers;
  if (isRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      const name = String(key).toLowerCase();
      names.push(name);
      values.set(name, value);
    }
  }
  if (Array.isArray(observation?.headerNames)) {
    for (const key of observation.headerNames) names.push(String(key).toLowerCase());
  }
  return { names, values };
}

export function hasPaymentRequiredHeader(observation) {
  if (observation?.hasPaymentRequiredHeader === true) return true;
  const { names, values } = headerEntries(observation);
  if (names.includes("payment-required")) return true;
  const raw = values.get("payment-required");
  return typeof raw === "string" ? raw.length > 0 : Boolean(raw);
}

function jsonrpcOf(observation) {
  if (isRecord(observation?.jsonrpc)) return observation.jsonrpc;
  if (isRecord(observation?.json)) return observation.json;
  if (isRecord(observation?.body) && observation.body.jsonrpc === "2.0") return observation.body;
  return null;
}

export function isPaymentRequired(value) {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.x402Version)) return false;
  if (!Array.isArray(value.accepts)) return false;
  return true;
}

export function paymentRequiredFromResult(result) {
  if (!isRecord(result)) return null;
  if (isPaymentRequired(result.structuredContent)) return result.structuredContent;
  const text = result.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return isPaymentRequired(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function paymentRequiredFromJsonRpc(jsonrpc) {
  const fromResult = paymentRequiredFromResult(jsonrpc?.result);
  if (fromResult) return fromResult;
  const data = jsonrpc?.error?.data;
  if (isPaymentRequired(data)) return data;
  if (isPaymentRequired(data?.x402)) return data.x402;
  return null;
}

export function textPaymentRequired(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return isPaymentRequired(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstAccept(challenge) {
  const accepts = Array.isArray(challenge?.accepts) ? challenge.accepts : [];
  return isRecord(accepts[0]) ? accepts[0] : null;
}

function resourceUrlOf(challenge) {
  const resource = challenge?.resource;
  if (typeof resource === "string") return resource;
  if (isRecord(resource) && typeof resource.url === "string") return resource.url;
  return null;
}

function paymentSentFromRequest(request) {
  return request.paymentSignatureSent === true
    || Boolean(request.headers?.["payment-signature"])
    || Boolean(request.headers?.["PAYMENT-SIGNATURE"])
    || Boolean(request.params?._meta?.["x402/payment"]);
}

/**
 * Classify an unpaid MCP tools/call HTTP observation.
 *
 * x402 MCP transport + @x402/mcp: unpaid paid-tool call is HTTP 200 JSON-RPC
 * *result* with camelCase isError:true and PaymentRequired in structuredContent
 * (and JSON-encoded in content[0].text). That hop is not HTTP 402, not a
 * JSON-RPC error, not a Payment-Required header, and not settlement.
 */
export function classifyToolsCallObservation(observation = {}, request = {}) {
  const httpStatus = Number(observation.httpStatus);
  const jsonrpc = jsonrpcOf(observation);
  const result = jsonrpc?.result;
  const rpcError = isRecord(jsonrpc?.error) ? jsonrpc.error : null;
  const isError = result?.isError === true;
  const snakeIsError = Object.hasOwn(result || {}, "is_error");
  const challenge = paymentRequiredFromJsonRpc(jsonrpc);
  const textChallenge = textPaymentRequired(result);
  const accept = firstAccept(challenge);
  const paymentRequiredHeader = hasPaymentRequiredHeader(observation);
  const invented = inventedHits({ observation, request });
  const paymentSignatureSent = paymentSentFromRequest(request);

  let kind = "unknown";
  if (paymentRequiredHeader) kind = "payment_required_header";
  else if (rpcError) kind = "jsonrpc_error_not_iserror";
  else if (httpStatus === 402) kind = "http_402";
  else if (httpStatus === 200 && snakeIsError && isError !== true) kind = "snake_case_is_error";
  else if (httpStatus === 200 && isError !== true && challenge) kind = "iserror_omitted";
  else if (httpStatus === 200 && isError && challenge) kind = "unpaid_mcp_challenge";
  else if (httpStatus === 200 && isError !== true && isRecord(result)) kind = "paid_delivery";

  const unpaidChallenge = kind === "unpaid_mcp_challenge";
  return {
    kind,
    httpStatus,
    isError,
    snakeIsError,
    hasJsonRpcError: Boolean(rpcError),
    jsonRpcErrorCode: Number.isInteger(rpcError?.code) ? rpcError.code : null,
    hasPaymentRequiredHeader: paymentRequiredHeader,
    charged: unpaidChallenge ? false : kind === "paid_delivery",
    paidDelivery: kind === "paid_delivery",
    successProven: false,
    settlement: false,
    resourceUrl: resourceUrlOf(challenge),
    amount: typeof accept?.amount === "string" ? accept.amount : null,
    payTo: typeof accept?.payTo === "string" ? accept.payTo : null,
    network: typeof accept?.network === "string" ? accept.network : null,
    asset: typeof accept?.asset === "string" ? accept.asset : null,
    error: typeof challenge?.error === "string" ? challenge.error : null,
    x402Version: challenge?.x402Version ?? null,
    hasStructuredContent: isPaymentRequired(result?.structuredContent),
    hasTextContent: Boolean(textChallenge),
    invented,
    paymentSignatureSent: Boolean(paymentSignatureSent),
    tool: request.params?.name || request.name || SDS.mcpTool,
  };
}

export function classifyToolsListObservation(observation = {}, request = {}) {
  const httpStatus = Number(observation.httpStatus);
  const jsonrpc = jsonrpcOf(observation);
  const tools = Array.isArray(jsonrpc?.result?.tools) ? jsonrpc.result.tools : [];
  const extract = tools.find((tool) => tool?.name === SDS.mcpTool) || observation.tool || null;
  const x402 = extract?._meta?.x402;
  const accept = firstAccept(x402);
  const paymentRequiredHeader = hasPaymentRequiredHeader(observation);
  const invented = inventedHits({ observation, request });
  const paymentRequired = x402?.paymentRequired === true;
  const unpaidList = httpStatus === 200 && paymentRequired && !paymentRequiredHeader;
  return {
    kind: unpaidList ? "unpaid_mcp_list" : paymentRequiredHeader ? "payment_required_header" : "unknown",
    httpStatus,
    hasPaymentRequiredHeader: paymentRequiredHeader,
    paymentRequired,
    charged: false,
    paidDelivery: false,
    successProven: false,
    settlement: false,
    amount: typeof accept?.amount === "string" ? accept.amount : null,
    payTo: typeof accept?.payTo === "string" ? accept.payTo : null,
    network: typeof accept?.network === "string" ? accept.network : null,
    asset: typeof accept?.asset === "string" ? accept.asset : null,
    toolCount: tools.length || observation.toolCount || 0,
    extractPresent: Boolean(extract),
    invented,
    paymentSignatureSent: request.paymentSignatureSent === true,
  };
}

export function claimsDemandCharge(claims) {
  if (!isRecord(claims)) return false;
  return claims.charged === true
    || claims.paidDelivery === true
    || claims.successProven === true
    || claims.settlement === true
    || claims.settled === true;
}
