import {
  CANONICAL_ATOMIC,
  FORBIDDEN_INVENTED,
  OPENAPI_PRICE_TOKEN,
  ROUTES,
} from "./constants.mjs";

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

export function isCanonicalAtomicString(value) {
  return typeof value === "string" && CANONICAL_ATOMIC.test(value);
}

/**
 * Strict string equality. Never Number(), never parseFloat, never BigInt.
 * "5000" !== 5000 !== "5000.0" !== "5e3" !== "05000".
 */
export function stringEqual(left, right) {
  return typeof left === "string" && typeof right === "string" && left === right;
}

export function classifyAtomic(value) {
  if (value == null || value === "") {
    return { kind: "missing", value: null, canonical: false };
  }
  if (typeof value !== "string") {
    return { kind: "not_string", value, canonical: false, jsType: typeof value };
  }
  if (!CANONICAL_ATOMIC.test(value)) {
    return { kind: "not_canonical", value, canonical: false };
  }
  return { kind: "canonical_string", value, canonical: true };
}

function firstAccept(container) {
  const accepts = Array.isArray(container?.accepts) ? container.accepts : [];
  return isRecord(accepts[0]) ? accepts[0] : null;
}

export function decodePaymentRequiredHeader(raw) {
  if (typeof raw !== "string" || !raw) return null;
  for (const encoding of ["base64", "base64url"]) {
    try {
      const decoded = JSON.parse(Buffer.from(raw, encoding).toString("utf8"));
      if (isRecord(decoded) && Array.isArray(decoded.accepts)) return decoded;
    } catch {
      /* try next encoding */
    }
  }
  return null;
}

export function challengeFromHttp(http = {}) {
  if (isRecord(http.challenge) && Array.isArray(http.challenge.accepts)) return http.challenge;
  if (isRecord(http.body) && Array.isArray(http.body.accepts)) return http.body;
  const header = http.paymentRequiredHeader
    || http.headers?.["payment-required"]
    || http.headers?.["PAYMENT-REQUIRED"];
  return decodePaymentRequiredHeader(header);
}

export function extractOpenApiPriceUsd(description) {
  if (typeof description !== "string") return null;
  const match = description.match(OPENAPI_PRICE_TOKEN);
  return match ? match[0] : null;
}

function headerHasPaymentRequired(http) {
  if (http?.hasPaymentRequiredHeader === true) return true;
  const headers = http?.headers;
  if (!isRecord(headers)) return false;
  return Object.keys(headers).some((key) => key.toLowerCase() === "payment-required");
}

function paymentSignatureSent(request = {}) {
  return request.paymentSignatureSent === true
    || Boolean(request.headers?.["payment-signature"])
    || Boolean(request.headers?.["PAYMENT-SIGNATURE"])
    || Boolean(request.headers?.["x-payment"])
    || Boolean(request.params?._meta?.["x402/payment"]);
}

export function claimsDemandSettlement(claims) {
  if (!isRecord(claims)) return false;
  return claims.charged === true
    || claims.paidDelivery === true
    || claims.successProven === true
    || claims.settlement === true
    || claims.settled === true
    || claims.treat402AsPaid === true;
}

export function claimsTreatAbsenceAsDemand(claims) {
  return isRecord(claims) && claims.treatAbsenceAsDemand === true;
}

/**
 * Classify one unpaid route observation for the w910 amount matrix.
 * HTTP 402 amount, MCP tools/list amount, well-known amount, and OpenAPI
 * 402 USD text are compared as strings to the SDS pin.
 */
export function classifyRouteObservation(routeId, observation = {}, request = {}) {
  const pin = ROUTES[routeId] || null;
  const http = isRecord(observation.http) ? observation.http : {};
  const mcp = isRecord(observation.mcp) ? observation.mcp : {};
  const openapi = isRecord(observation.openapi) ? observation.openapi : {};
  const wellKnown = isRecord(observation.wellKnown) ? observation.wellKnown : {};
  const challenge = challengeFromHttp(http);
  const accept = firstAccept(challenge);
  const httpAmountRaw = Object.hasOwn(http, "amount")
    ? http.amount
    : (accept?.amount ?? accept?.maxAmountRequired ?? null);
  const mcpAccept = firstAccept(mcp.x402 || mcp);
  const mcpAmountRaw = Object.hasOwn(mcp, "amount")
    ? mcp.amount
    : mcpAccept?.amount ?? null;
  const wellKnownAmountRaw = Object.hasOwn(wellKnown, "amount")
    ? wellKnown.amount
    : firstAccept(wellKnown)?.amount ?? null;
  const openapiDescription = typeof openapi.description402 === "string"
    ? openapi.description402
    : (typeof openapi.description === "string" ? openapi.description : null);
  const openapiPriceUsd = Object.hasOwn(openapi, "priceUsd")
    ? openapi.priceUsd
    : extractOpenApiPriceUsd(openapiDescription);
  const httpAtomic = classifyAtomic(httpAmountRaw);
  const mcpAtomic = classifyAtomic(mcpAmountRaw);
  const wellKnownAtomic = classifyAtomic(wellKnownAmountRaw);
  const invented = inventedHits({ observation, request });
  const httpStatus = Number(http.httpStatus);
  const mcpStatus = Number(mcp.httpStatus);
  const mcpPresent = mcp.toolPresent === true
    || mcp.paymentRequired === true
    || mcpAmountRaw != null
    || Boolean(mcp.tool);
  const wellKnownPresent = wellKnown.present !== false
    && (wellKnownAmountRaw != null || wellKnown.present === true);
  const openapiPresent = openapi.present !== false
    && (openapiPriceUsd != null || typeof openapiDescription === "string");

  const surfaces = {
    http: httpAtomic.value,
    mcp: mcpAtomic.value,
    wellKnown: wellKnownAtomic.value,
  };
  const presentCanonical = Object.entries(surfaces)
    .filter(([, value]) => isCanonicalAtomicString(value))
    .map(([, value]) => value);
  const uniqueCanonical = [...new Set(presentCanonical)];
  const crossSurfaceDrift = uniqueCanonical.length > 1;

  return {
    routeId,
    pin,
    httpStatus,
    mcpStatus,
    httpKind: httpStatus === 402 ? "unpaid_http_402" : httpStatus === 200 ? "http_200" : "http_other",
    mcpKind: mcpStatus === 200 && mcp.paymentRequired === true ? "unpaid_mcp_list" : "mcp_other",
    hasPaymentRequiredHeader: headerHasPaymentRequired(http),
    httpAmount: httpAtomic,
    mcpAmount: mcpAtomic,
    wellKnownAmount: wellKnownAtomic,
    maxAmountRequired: accept?.maxAmountRequired ?? http.maxAmountRequired ?? null,
    openapiPriceUsd: typeof openapiPriceUsd === "string" ? openapiPriceUsd : null,
    openapiDescription,
    mcpPresent,
    wellKnownPresent,
    openapiPresent,
    paymentRequired: mcp.paymentRequired === true,
    payTo: typeof (accept?.payTo || http.payTo) === "string" ? (accept?.payTo || http.payTo) : null,
    network: typeof (accept?.network || http.network) === "string" ? (accept?.network || http.network) : null,
    asset: typeof (accept?.asset || http.asset) === "string" ? (accept?.asset || http.asset) : null,
    crossSurfaceDrift,
    uniqueCanonicalAmounts: uniqueCanonical,
    invented,
    paymentSignatureSent: paymentSignatureSent(request),
    charged: false,
    paidDelivery: httpStatus === 200 && httpStatus !== 402,
    settlement: false,
    pinAmount: pin?.amountAtomic ?? null,
    pinPriceUsd: pin?.priceUsd ?? null,
  };
}


