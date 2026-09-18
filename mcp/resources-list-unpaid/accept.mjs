import {
  BOUNDARY,
  SCHEMA,
  UNPAID_RESOURCE_NAMES,
  UNPAID_RESOURCE_URIS,
} from "./catalog.mjs";
import { responseHadPaymentChallenge } from "./decode.mjs";

export const ACCEPT_CODES = Object.freeze({
  RESOURCES_LIST_PAID: "RESOURCES_LIST_PAID",
  RESOURCES_LIST_HTTP_ERROR: "RESOURCES_LIST_HTTP_ERROR",
  RESOURCES_LIST_JSONRPC_ERROR: "RESOURCES_LIST_JSONRPC_ERROR",
  RESOURCES_LIST_MISSING: "RESOURCES_LIST_MISSING",
  RESOURCES_LIST_EMPTY: "RESOURCES_LIST_EMPTY",
  RESOURCES_LIST_CATALOG_MISMATCH: "RESOURCES_LIST_CATALOG_MISMATCH",
  RESOURCES_LIST_PAYMENT_SENT: "RESOURCES_LIST_PAYMENT_SENT",
  RESOURCES_LIST_INVALID: "RESOURCES_LIST_INVALID",
});

function fail(code, message, extra = {}) {
  return {
    ok: false,
    schema: SCHEMA,
    paymentRequired: false,
    paymentSent: false,
    boundary: BOUNDARY,
    error: {
      code,
      message,
      ...(code === ACCEPT_CODES.RESOURCES_LIST_PAID ? { capturePaymentRequired: true } : {}),
      ...extra,
    },
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function paymentRequiredPayload(value) {
  if (!isObject(value)) return false;
  if (Number.isInteger(value.x402Version) && Array.isArray(value.accepts)) return true;
  if (value.paymentRequired === true) return true;
  if (value._meta?.["x402/paymentRequired"] === true) return true;
  if (isObject(value.x402) && value.x402.paymentRequired === true) return true;
  if (isObject(value.structuredContent) && paymentRequiredPayload(value.structuredContent)) return true;
  if (typeof value.content?.[0]?.text === "string") {
    try {
      if (paymentRequiredPayload(JSON.parse(value.content[0].text))) return true;
    } catch {
      /* not JSON */
    }
  }
  return false;
}

function jsonRpcPaymentError(json) {
  const code = json?.error?.code;
  if (code === -32042 || code === 402) return true;
  if (isObject(json?.error?.data) && paymentRequiredPayload(json.error.data)) return true;
  return false;
}

/**
 * Accept a captured or live MCP resources/list response only when it is unpaid discovery.
 */
export function acceptResourcesList(capture = {}) {
  const httpStatus = Number(capture.httpStatus);
  const json = capture.json;
  const headers = capture.headers || {};
  const paymentSent = capture.paymentSent === true;

  if (paymentSent) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_PAYMENT_SENT, "resources/list must not send a payment credential");
  }
  if (httpStatus === 402 || responseHadPaymentChallenge(headers) || paymentRequiredPayload(json) || jsonRpcPaymentError(json)) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_PAID, "resources/list returned a payment challenge; discovery must be unpaid");
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_HTTP_ERROR, `resources/list HTTP ${httpStatus || "missing"}`);
  }
  if (!isObject(json) || json.jsonrpc !== "2.0") {
    return fail(ACCEPT_CODES.RESOURCES_LIST_INVALID, "resources/list is not a JSON-RPC 2.0 object");
  }
  if (Object.hasOwn(json, "error")) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_JSONRPC_ERROR, json.error?.message || "resources/list JSON-RPC error", {
      rpcCode: json.error?.code,
    });
  }
  const result = json.result;
  if (!isObject(result)) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_MISSING, "resources/list result is missing");
  }
  if (result.isError === true || paymentRequiredPayload(result)) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_PAID, "resources/list result is a payment-required tool-style body");
  }
  const resources = result.resources;
  if (!Array.isArray(resources)) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_MISSING, "resources/list is missing resources");
  }
  if (resources.length === 0) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_EMPTY, "resources/list returned no unpaid resources");
  }

  const uris = [];
  const names = [];
  for (const item of resources) {
    if (!isObject(item) || typeof item.uri !== "string" || typeof item.name !== "string") {
      return fail(ACCEPT_CODES.RESOURCES_LIST_INVALID, "resources/list entry is missing uri or name");
    }
    if (item.paymentRequired === true || item._meta?.["x402/paymentRequired"] === true) {
      return fail(ACCEPT_CODES.RESOURCES_LIST_PAID, `resource ${item.uri} is marked payment-required`);
    }
    if (paymentRequiredPayload(item)) {
      return fail(ACCEPT_CODES.RESOURCES_LIST_PAID, `resource ${item.uri} carries payment requirements`);
    }
    uris.push(item.uri);
    names.push(item.name);
  }

  const expectedUris = new Set(UNPAID_RESOURCE_URIS);
  const listedUris = new Set(uris);
  const missing = [...expectedUris].filter((uri) => !listedUris.has(uri));
  const extra = [...listedUris].filter((uri) => !expectedUris.has(uri));
  if (missing.length || extra.length) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_CATALOG_MISMATCH, "resources/list catalog mismatch", { missing, extra });
  }

  return {
    ok: true,
    schema: SCHEMA,
    paymentRequired: false,
    paymentSent: false,
    boundary: BOUNDARY,
    count: resources.length,
    uris,
    names,
    resources,
  };
}

export function acceptInitialize(capture = {}) {
  const json = capture.json;
  const capabilities = json?.result?.capabilities;
  if (!isObject(json?.result) || json.result.protocolVersion == null) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_INVALID, "initialize did not return a protocol version");
  }
  if (!isObject(capabilities) || !isObject(capabilities.resources)) {
    return fail(ACCEPT_CODES.RESOURCES_LIST_MISSING, "initialize did not advertise resources capability");
  }
  return {
    ok: true,
    schema: SCHEMA,
    protocolVersion: json.result.protocolVersion,
    serverInfo: json.result.serverInfo,
    capabilities: capabilities.resources,
  };
}

export { UNPAID_RESOURCE_NAMES, UNPAID_RESOURCE_URIS };
