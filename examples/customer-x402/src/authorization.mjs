import { getAddress } from "viem";

import { DEFAULT_REQUIRED_OUTPUT, LIVE_METHOD } from "./constants.mjs";

export class AuthorizationRefusal extends Error {
  constructor(message, { field = null } = {}) {
    super(message);
    this.name = "AuthorizationRefusal";
    this.code = "authorization_refused";
    this.field = field;
  }
}

function fail(message, field = null) {
  throw new AuthorizationRefusal(message, { field });
}

function normalizeHttpsUrl(raw, label) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    fail(`${label} must be an absolute HTTPS URL`, label);
  }
  if (url.protocol !== "https:") fail(`${label} must use HTTPS`, label);
  if (url.protocol === "mcp:" || String(raw).startsWith("mcp://")) {
    fail(`${label} must not use mcp://`, label);
  }
  if (url.username || url.password) fail(`${label} must not contain credentials`, label);
  if (url.hash) fail(`${label} must not contain a fragment`, label);
  url.searchParams.sort();
  return url;
}

function normalizeAddress(value, label) {
  try {
    return getAddress(String(value || ""));
  } catch {
    fail(`${label} must be a checksummable EVM address`, label);
  }
}

function normalizeAtomic(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) fail(`${label} must be a non-negative integer string`, label);
  return BigInt(raw);
}

/**
 * Bind the exact customer-authorized purchase shape before any wallet access.
 * HTTP payment credentials must never be transplanted into mcp:// resources.
 */
export function normalizeAuthorization(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("authorization must be an object");
  }
  const method = String(input.method || LIVE_METHOD).toUpperCase();
  if (method !== "GET") fail("authorization method must be GET", "method");
  if (input.body !== undefined && input.body !== null) {
    fail("authorization for GET /extract must not include a body", "body");
  }
  const url = normalizeHttpsUrl(input.url, "url");
  if (url.pathname !== "/extract") fail("authorization path must be /extract", "url");
  if (!url.searchParams.get("url")) fail("authorization query must include url=", "url");
  const network = String(input.network || "").trim();
  if (!/^eip155:\d+$/.test(network)) fail("authorization network must look like eip155:<id>", "network");
  const asset = normalizeAddress(input.asset, "asset");
  const recipient = normalizeAddress(input.recipient, "recipient");
  const amountCapAtomic = normalizeAtomic(input.amountCapAtomic, "amountCapAtomic");
  const requiredOutput = input.requiredOutput || DEFAULT_REQUIRED_OUTPUT;
  if (!requiredOutput || typeof requiredOutput !== "object") fail("requiredOutput is required", "requiredOutput");
  if (requiredOutput.mediaType !== "application/json") {
    fail("requiredOutput.mediaType must be application/json", "requiredOutput");
  }
  if (!Array.isArray(requiredOutput.requiredFields) || !requiredOutput.requiredFields.length) {
    fail("requiredOutput.requiredFields must be a non-empty array", "requiredOutput");
  }
  return Object.freeze({
    method,
    url: url.toString(),
    origin: url.origin,
    path: url.pathname,
    query: url.search,
    network,
    asset,
    recipient,
    amountCapAtomic: amountCapAtomic.toString(),
    requiredOutput: Object.freeze({
      mediaType: "application/json",
      requiredFields: Object.freeze([...requiredOutput.requiredFields].map(String)),
      maxResponseBytes: Number(requiredOutput.maxResponseBytes ?? 500_000),
    }),
  });
}

export function assertRequestMatchesAuthorization(requestUrl, authorization, { method = "GET", body } = {}) {
  const auth = normalizeAuthorization(authorization);
  if (String(method || "GET").toUpperCase() !== auth.method) {
    fail(`request method ${method} does not match authorized ${auth.method}`, "method");
  }
  if (body !== undefined && body !== null && body !== "") {
    fail("request body is not authorized for GET /extract", "body");
  }
  const actual = normalizeHttpsUrl(requestUrl, "request url");
  if (actual.toString() !== auth.url) {
    fail("request URL does not match the exact authorized HTTPS origin/path/query", "url");
  }
  return auth;
}

/**
 * Compare a live or fixture accept option to the customer authorization.
 * Refusals happen before any signer or wallet credential is used.
 */
export function assertAcceptMatchesAuthorization(accept, authorization) {
  const auth = normalizeAuthorization(authorization);
  if (!accept || typeof accept !== "object") fail("accept option is required");
  if (accept.scheme !== "exact") fail("only the exact scheme is authorized", "scheme");
  if (accept.network !== auth.network) {
    fail(`network ${accept.network} does not match authorized ${auth.network}`, "network");
  }
  let asset;
  let payTo;
  try {
    asset = getAddress(accept.asset);
    payTo = getAddress(accept.payTo);
  } catch {
    fail("accept asset/payTo must be EVM addresses", "asset");
  }
  if (asset !== auth.asset) fail(`asset ${asset} does not match authorized ${auth.asset}`, "asset");
  if (payTo !== auth.recipient) {
    fail(`recipient ${payTo} does not match authorized ${auth.recipient}`, "recipient");
  }
  const amount = normalizeAtomic(accept.amount ?? accept.maxAmountRequired, "accept.amount");
  const cap = BigInt(auth.amountCapAtomic);
  if (amount > cap) {
    fail(`amount ${amount} exceeds authorized amountCapAtomic ${cap}`, "amount");
  }
  return Object.freeze({
    ...auth,
    selectedAmountAtomic: amount.toString(),
  });
}
