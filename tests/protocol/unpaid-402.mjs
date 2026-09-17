import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_SCHEMA = "samedaydesk.x402-protocol-fixtures.unpaid-402.v1";
export const X402_VERSION = 2;
export const MAX_HEADER_BYTES = 1_000_000;
export const MAX_TIMEOUT_SECONDS = 86_400;

const CAIP2 = /^[a-z0-9]+:[A-Za-z0-9._-]+$/;
const ATOMIC_AMOUNT = /^(?:0|[1-9]\d*)$/;
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

const PAID_REQUEST_HEADERS = new Set(["payment-signature", "x-payment-signature"]);
const PAID_RESPONSE_HEADERS = new Set([
  "payment-response",
  "x-payment-response",
  "payment-receipt",
  "x-payment-receipt",
]);

export function protocolFixturesRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "protocol");
}

export function headerMap(headers) {
  const map = new Map();
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return map;
  for (const [name, value] of Object.entries(headers)) {
    if (typeof name !== "string") continue;
    map.set(name.toLowerCase(), value);
  }
  return map;
}

export function headerValue(headers, name) {
  const value = headerMap(headers).get(String(name).toLowerCase());
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

export function decodeBase64Json(value) {
  if (typeof value !== "string" || value.length < 4 || value.length > MAX_HEADER_BYTES) {
    return { ok: false, error: "missing_or_oversized_header" };
  }
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    return { ok: false, error: "header_not_base64" };
  }
  let decoded;
  try {
    decoded = Buffer.from(value, "base64");
  } catch {
    return { ok: false, error: "header_not_base64" };
  }
  if (!decoded.length) return { ok: false, error: "header_not_base64" };
  try {
    const parsed = JSON.parse(decoded.toString("utf8"));
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: "header_not_json" };
  }
}

export function encodePaymentRequiredHeader(paymentRequired) {
  return Buffer.from(JSON.stringify(paymentRequired), "utf8").toString("base64");
}

function fail(code, message, extra = {}) {
  return { ok: false, verdict: "reject", code, errors: [message], ...extra };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPaymentPayload(value) {
  if (!isRecord(value)) return false;
  if (!isRecord(value.accepted) || !isRecord(value.payload)) return false;
  return "signature" in value.payload || "authorization" in value.payload;
}

export function isSettlementResponse(value) {
  if (!isRecord(value)) return false;
  if (typeof value.success !== "boolean") return false;
  if (!("transaction" in value) || !("network" in value)) return false;
  return !Array.isArray(value.accepts);
}

function requestCarriesPayment(request, transport) {
  const headers = headerMap(request?.headers);
  for (const name of PAID_REQUEST_HEADERS) {
    const value = headers.get(name);
    if (typeof value === "string" && value.length > 0) {
      return { paid: true, reason: `request carries ${name}` };
    }
  }
  const authorization = headers.get("authorization");
  if (typeof authorization === "string" && /^\s*Payment\s+/i.test(authorization)) {
    return { paid: true, reason: "request carries Authorization: Payment" };
  }
  if (transport === "mcp") {
    const meta = request?.params?._meta;
    if (isRecord(meta) && isRecord(meta["x402/payment"])) {
      return { paid: true, reason: "request carries _meta[x402/payment]" };
    }
  }
  return { paid: false };
}

function responseCarriesSettlement(headers) {
  const map = headerMap(headers);
  for (const name of PAID_RESPONSE_HEADERS) {
    const value = map.get(name);
    if (typeof value === "string" && value.length > 0) {
      return { paid: true, header: name };
    }
  }
  return { paid: false };
}

function validateResource(resource, errors, prefix = "resource") {
  if (!isRecord(resource)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (typeof resource.url !== "string" || resource.url.length === 0 || resource.url.length > 2048) {
    errors.push(`${prefix}.url must be a non-empty string`);
  } else {
    try {
      const url = new URL(resource.url);
      if (!["http:", "https:", "mcp:"].includes(url.protocol)) {
        errors.push(`${prefix}.url must use http, https, or mcp`);
      }
    } catch {
      errors.push(`${prefix}.url is not an absolute URL`);
    }
  }
  if (resource.description !== undefined && typeof resource.description !== "string") {
    errors.push(`${prefix}.description must be a string when present`);
  }
  if (resource.mimeType !== undefined && typeof resource.mimeType !== "string") {
    errors.push(`${prefix}.mimeType must be a string when present`);
  }
  if (resource.serviceName !== undefined) {
    if (typeof resource.serviceName !== "string" || !PRINTABLE_ASCII.test(resource.serviceName) || resource.serviceName.length > 32) {
      errors.push(`${prefix}.serviceName must be printable ASCII up to 32 characters`);
    }
  }
  if (resource.tags !== undefined) {
    if (!Array.isArray(resource.tags) || resource.tags.length > 5 || resource.tags.some((tag) => typeof tag !== "string" || !PRINTABLE_ASCII.test(tag) || tag.length > 32)) {
      errors.push(`${prefix}.tags must be at most 5 printable ASCII strings of max 32 characters`);
    }
  }
  if (resource.iconUrl !== undefined) {
    try {
      const icon = new URL(resource.iconUrl);
      if (!["http:", "https:"].includes(icon.protocol)) errors.push(`${prefix}.iconUrl must be an http(s) URL`);
    } catch {
      errors.push(`${prefix}.iconUrl must be an absolute URL`);
    }
  }
}

function validateAccept(accept, index, errors) {
  const label = `accepts[${index}]`;
  if (!isRecord(accept)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof accept.scheme !== "string" || accept.scheme.length === 0) {
    errors.push(`${label}.scheme is required`);
  }
  if (typeof accept.network !== "string" || !CAIP2.test(accept.network)) {
    errors.push(`${label}.network must be CAIP-2`);
  }
  if (typeof accept.amount !== "string" || !ATOMIC_AMOUNT.test(accept.amount) || BigInt(accept.amount) <= 0n) {
    errors.push(`${label}.amount must be a positive atomic integer string`);
  }
  if (typeof accept.asset !== "string" || accept.asset.length === 0) {
    errors.push(`${label}.asset is required`);
  }
  if (typeof accept.payTo !== "string" || accept.payTo.length === 0) {
    errors.push(`${label}.payTo is required`);
  }
  if (!Number.isInteger(accept.maxTimeoutSeconds) || accept.maxTimeoutSeconds <= 0 || accept.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) {
    errors.push(`${label}.maxTimeoutSeconds must be an integer in 1..${MAX_TIMEOUT_SECONDS}`);
  }
  if (accept.extra !== undefined && !isRecord(accept.extra)) {
    errors.push(`${label}.extra must be an object when present`);
  }
}

function validateExtensions(extensions, errors) {
  if (extensions === undefined) return;
  if (!isRecord(extensions)) {
    errors.push("extensions must be an object when present");
    return;
  }
  for (const [key, value] of Object.entries(extensions)) {
    if (!isRecord(value) || !isRecord(value.info) || !isRecord(value.schema)) {
      errors.push(`extensions[${key}] must have info and schema objects`);
    }
  }
}

export function validatePaymentRequired(value) {
  if (isPaymentPayload(value)) {
    return fail("paid_as_unpaid", "object is a PaymentPayload (accepted + payload), not unpaid PaymentRequired");
  }
  if (isSettlementResponse(value)) {
    return fail("paid_as_unpaid", "object is a SettlementResponse, not unpaid PaymentRequired");
  }
  if (!isRecord(value)) {
    return fail("malformed_payment_required", "PaymentRequired must be a JSON object");
  }
  if (value.x402Version !== X402_VERSION) {
    return fail("unsupported_version", `x402Version must be ${X402_VERSION}`, { x402Version: value.x402Version });
  }
  if ("accepted" in value || isRecord(value.payload)) {
    return fail("paid_as_unpaid", "PaymentRequired must not carry PaymentPayload fields accepted/payload");
  }
  const errors = [];
  if (value.error !== undefined && typeof value.error !== "string") {
    errors.push("error must be a string when present");
  }
  validateResource(value.resource, errors);
  if (!Array.isArray(value.accepts)) {
    errors.push("accepts must be an array");
  } else if (value.accepts.length === 0) {
    errors.push("accepts must contain at least one payment requirement");
  } else {
    value.accepts.slice(0, 32).forEach((accept, index) => validateAccept(accept, index, errors));
  }
  validateExtensions(value.extensions, errors);
  if (errors.length) {
    return fail("malformed_payment_required", errors[0], { errors });
  }
  return {
    ok: true,
    verdict: "unpaid_402",
    code: "ok",
    errors: [],
    paymentRequired: value,
  };
}

function classifyHttp(fixture) {
  const request = fixture.request || {};
  const response = fixture.response || {};
  const paidRequest = requestCarriesPayment(request, "http");
  if (paidRequest.paid) {
    return fail("paid_as_unpaid", paidRequest.reason);
  }
  const settled = responseCarriesSettlement(response.headers);
  if (settled.paid) {
    return fail("paid_as_unpaid", `response carries ${settled.header}`);
  }
  const status = Number(response.status);
  if (status !== 402) {
    return fail("not_unpaid_402", `HTTP ${status || "unknown"} is not 402 Payment Required`);
  }
  const encoded = headerValue(response.headers, "payment-required")
    || headerValue(response.headers, "x-payment-required");
  if (!encoded) {
    return fail("malformed_payment_required", "HTTP 402 missing PAYMENT-REQUIRED header");
  }
  const decoded = decodeBase64Json(encoded);
  if (!decoded.ok) {
    return fail("malformed_payment_required", decoded.error);
  }
  const required = validatePaymentRequired(decoded.value);
  if (!required.ok) return required;
  if (response.body !== undefined && response.body !== null) {
    if (isSettlementResponse(response.body) || isPaymentPayload(response.body)) {
      return fail("paid_as_unpaid", "HTTP 402 body is a paid payload, not PaymentRequired or empty");
    }
    if (isRecord(response.body) && Object.keys(response.body).length > 0 && !Array.isArray(response.body.accepts)) {
      if (response.body.ok === true || response.body.data !== undefined || response.body.success === true) {
        return fail("paid_as_unpaid", "HTTP 402 body looks like a settled product response");
      }
    }
  }
  return {
    ok: true,
    verdict: "unpaid_402",
    code: "ok",
    errors: [],
    paymentRequired: required.paymentRequired,
    transport: "http",
  };
}

function classifyMcp(fixture) {
  const request = fixture.request || {};
  const response = fixture.response || {};
  const paidRequest = requestCarriesPayment(request, "mcp");
  if (paidRequest.paid) {
    return fail("paid_as_unpaid", paidRequest.reason);
  }
  if (response.httpStatus !== undefined && Number(response.httpStatus) !== 200) {
    return fail("not_unpaid_402", `MCP HTTP ${response.httpStatus} is not the unpaid tool-result envelope`);
  }
  const result = response.result;
  if (!isRecord(result)) {
    return fail("malformed_payment_required", "MCP response missing result");
  }
  if (isRecord(result._meta) && (result._meta["x402/payment-response"] || result._meta["x402/payment"])) {
    return fail("paid_as_unpaid", "MCP result _meta carries payment or payment-response");
  }
  if (result.isError !== true) {
    return fail("paid_as_unpaid", "MCP unpaid PaymentRequired must be a tool result with isError true");
  }
  let paymentRequired = result.structuredContent;
  if (!isRecord(paymentRequired) && Array.isArray(result.content) && typeof result.content[0]?.text === "string") {
    try {
      paymentRequired = JSON.parse(result.content[0].text);
    } catch {
      return fail("malformed_payment_required", "MCP content[0].text is not PaymentRequired JSON");
    }
  }
  const required = validatePaymentRequired(paymentRequired);
  if (!required.ok) return required;
  if (Array.isArray(result.content) && typeof result.content[0]?.text === "string") {
    try {
      const fromText = JSON.parse(result.content[0].text);
      if (fromText?.x402Version !== required.paymentRequired.x402Version) {
        return fail("malformed_payment_required", "MCP content text is not the same PaymentRequired");
      }
    } catch {
      return fail("malformed_payment_required", "MCP content[0].text is not JSON");
    }
  }
  return {
    ok: true,
    verdict: "unpaid_402",
    code: "ok",
    errors: [],
    paymentRequired: required.paymentRequired,
    transport: "mcp",
  };
}

export function classifyUnpaid402(fixture) {
  if (!isRecord(fixture)) {
    return fail("malformed_fixture", "fixture must be an object");
  }
  const transport = fixture.transport;
  if (transport === "http") return classifyHttp(fixture);
  if (transport === "mcp") return classifyMcp(fixture);
  return fail("malformed_fixture", `unsupported transport ${transport}`);
}

export function classifyHttpExchange({ method = "GET", url, requestHeaders = {}, status, responseHeaders = {}, body } = {}) {
  return classifyUnpaid402({
    id: "live-exchange",
    transport: "http",
    request: { method, url, headers: requestHeaders },
    response: { status, headers: responseHeaders, body },
  });
}

export function loadProtocolManifest(root = protocolFixturesRoot()) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (manifest.schema !== FIXTURE_SCHEMA) {
    throw new Error(`unexpected fixture schema ${manifest.schema}`);
  }
  return manifest;
}

export function listProtocolFixtureFiles(root = protocolFixturesRoot()) {
  const files = [];
  for (const dir of ["unpaid", "reject"]) {
    const folder = join(root, dir);
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith(".json")) continue;
      files.push(join(dir, name));
    }
  }
  return files;
}

export function loadProtocolFixtures(root = protocolFixturesRoot()) {
  const manifest = loadProtocolManifest(root);
  const fixtures = manifest.fixtures.map((entry) => {
    const path = join(root, entry.path);
    const fixture = JSON.parse(readFileSync(path, "utf8"));
    return { ...entry, path, relativePath: relative(root, path), fixture };
  });
  return { root, manifest, fixtures };
}
