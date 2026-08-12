import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

import { Challenge } from "mppx";
import { SCHEMAS, evaluateOfferCoherence, evaluateResponseContract } from "agent-payment-policy";

const MAX_URL_LENGTH = 2_048;
const MAX_HEADER_VALUE_BYTES = 64 * 1024;
const MAX_OPENAPI_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const SENSITIVE_QUERY_KEY = /(?:^|[-_.])(api[-_.]?key|access[-_.]?token|auth|authorization|credential|password|secret|token)(?:$|[-_.])/i;
const CATALOG_SOURCE = /^[\u0020-\u007e]{1,128}$/;

const blockedAddresses = new BlockList();
for (const [address, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
]) blockedAddresses.addSubnet(address, prefix, family);

export class PaymentOfferPreflightError extends Error {
  constructor(message, { code = "preflight_failed", statusCode = 400 } = {}) {
    super(message);
    this.name = "PaymentOfferPreflightError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(message, options) {
  throw new PaymentOfferPreflightError(message, options);
}

function cleanString(value, maximum = 500) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function publicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function normalizePaymentTarget(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > MAX_URL_LENGTH) fail("url is required and must be at most 2048 characters", { code: "invalid_url" });
  let target;
  try {
    target = new URL(raw);
  } catch {
    fail("url must be a valid absolute HTTPS URL", { code: "invalid_url" });
  }
  if (target.protocol !== "https:") fail("url must use HTTPS", { code: "invalid_url" });
  if (target.username || target.password) fail("url must not contain credentials", { code: "credential_rejected" });
  if (target.hash) fail("url must not contain a fragment", { code: "invalid_url" });
  if (/[{}]/.test(target.pathname) || /:\w+/.test(target.pathname)) {
    fail("url contains an unresolved route parameter", { code: "invalid_url" });
  }
  if (target.searchParams.size > 30) fail("url has too many query parameters", { code: "invalid_url" });
  for (const key of target.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      fail("url contains a credential-like query key", { code: "credential_rejected" });
    }
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    fail("url host is not public", { code: "ssrf_rejected" });
  }
  if (isIP(hostname) && !publicAddress(hostname)) {
    fail("url host is not public", { code: "ssrf_rejected" });
  }
  target.searchParams.sort();
  return target;
}

function strictRecord(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`, { code: "invalid_catalog" });
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length) fail(`${label} contains unsupported fields: ${extras.join(", ")}`, { code: "invalid_catalog" });
  return value;
}

export function normalizePaymentOfferPreflightInput(input) {
  const value = typeof input === "string" ? { url: input } : strictRecord(
    input,
    "request",
    new Set(["url", "catalog"]),
  );
  const target = normalizePaymentTarget(value.url);
  if (value.catalog === undefined || value.catalog === null) return { url: target.toString(), catalog: null };
  const catalog = strictRecord(value.catalog, "catalog", new Set([
    "source", "protocol", "method", "url", "amountAtomic", "network", "asset", "recipient", "expiresAt",
  ]));
  const source = cleanString(catalog.source, 128);
  if (!source || !CATALOG_SOURCE.test(source)) fail("catalog source is invalid", { code: "invalid_catalog" });
  if (String(catalog.method || "").toUpperCase() !== "GET") fail("catalog method must be GET", { code: "invalid_catalog" });
  const normalized = { source, method: "GET", url: normalizePaymentTarget(catalog.url).toString() };
  if (catalog.protocol !== undefined) {
    const protocol = String(catalog.protocol).toLowerCase();
    if (!new Set(["x402", "mpp"]).has(protocol)) fail("catalog protocol must be x402 or mpp", { code: "invalid_catalog" });
    normalized.protocol = protocol;
  }
  if (catalog.amountAtomic !== undefined) {
    const amount = String(catalog.amountAtomic);
    if (!/^(?:0|[1-9][0-9]{0,77})$/.test(amount)) fail("catalog amountAtomic is invalid", { code: "invalid_catalog" });
    normalized.amountAtomic = amount;
  }
  for (const field of ["network", "asset", "recipient"]) {
    if (catalog[field] === undefined) continue;
    const item = cleanString(catalog[field], 200);
    if (!item) fail(`catalog ${field} is invalid`, { code: "invalid_catalog" });
    normalized[field] = item;
  }
  if (catalog.expiresAt !== undefined) {
    const expiry = Date.parse(catalog.expiresAt);
    if (!Number.isFinite(expiry)) fail("catalog expiresAt is invalid", { code: "invalid_catalog" });
    normalized.expiresAt = new Date(expiry).toISOString();
  }
  return { url: target.toString(), catalog: normalized };
}

export function paymentOfferPreflightInputSchema() {
  return {
    type: "object",
    properties: {
      url: {
        type: "string",
        format: "uri",
        maxLength: 2048,
        description: "Exact public HTTPS GET URL whose unpaid payment challenges should be inspected.",
      },
      catalog: {
        type: "object",
        description: "Optional caller-supplied catalog candidate to compare with each live unsigned offer.",
        properties: {
          source: { type: "string", minLength: 1, maxLength: 128 },
          protocol: { type: "string", enum: ["x402", "mpp"] },
          method: { type: "string", const: "GET" },
          url: { type: "string", format: "uri", maxLength: 2048 },
          amountAtomic: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,77})$" },
          network: { type: "string", minLength: 1, maxLength: 200 },
          asset: { type: "string", minLength: 1, maxLength: 200 },
          recipient: { type: "string", minLength: 1, maxLength: 200 },
          expiresAt: { type: "string", format: "date-time" },
        },
        required: ["source", "method", "url"],
        additionalProperties: false,
      },
    },
    required: ["url"],
    additionalProperties: false,
  };
}

export function paymentOfferPreflightOutputSchema() {
  return {
    type: "object",
    properties: {
      ok: { type: "boolean", const: true },
      product: { type: "string", const: "samedaydesk-payment-offer-preflight" },
      version: { type: "string", const: "1.2.0" },
      checkedAt: { type: "string", format: "date-time" },
      target: { type: "object" },
      decision: { type: "string", enum: ["parseable_offer", "review_required", "no_parseable_offer"] },
      protocols: { type: "array", items: { type: "string", enum: ["mpp", "x402"] } },
      offerCount: { type: "integer", minimum: 0 },
      offers: { type: "array" },
      parity: { type: "object" },
      catalogCoherence: { type: "array" },
      responseContract: { type: "object" },
      responseContractAcquisition: { type: "object" },
      findings: { type: "array" },
      boundary: { type: "object" },
    },
    required: ["ok", "product", "version", "checkedAt", "target", "decision", "protocols", "offerCount", "offers", "parity", "catalogCoherence", "responseContract", "responseContractAcquisition", "findings", "boundary"],
    additionalProperties: false,
  };
}

export async function resolvePublicAddress(hostname, { lookupImpl = dnsLookup } = {}) {
  if (isIP(hostname)) return { address: hostname, family: isIP(hostname) };
  let addresses;
  try {
    addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch {
    fail("target hostname could not be resolved", { code: "dns_failed", statusCode: 502 });
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    fail("target hostname has no resolved address", { code: "dns_failed", statusCode: 502 });
  }
  if (addresses.some((entry) => !publicAddress(entry?.address))) {
    fail("target hostname resolves to a non-public address", { code: "ssrf_rejected" });
  }
  return addresses[0];
}

function headersFromRaw(rawHeaders = []) {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name === "string" && typeof value === "string") headers.append(name, value);
  }
  return headers;
}

export function createPinnedLookup(resolved) {
  return (_hostname, options, callback) => {
    if (options?.all === true) return callback(null, [{ address: resolved.address, family: resolved.family }]);
    return callback(null, resolved.address, resolved.family);
  };
}

export async function requestPaymentHeaders(target, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  lookupImpl = dnsLookup,
} = {}) {
  const resolved = await resolvePublicAddress(target.hostname.replace(/^\[|\]$/g, ""), { lookupImpl });
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpsRequest(target, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "SameDayDesk-Payment-Offer-Preflight/1.0 (+https://samedaydesk.com)",
      },
      maxHeaderSize: MAX_HEADER_VALUE_BYTES,
      lookup: createPinnedLookup(resolved),
    }, (response) => {
      const result = {
        finalUrl: target.toString(),
        headers: headersFromRaw(response.rawHeaders),
        status: Number(response.statusCode || 0),
      };
      settled = true;
      resolve(result);
      response.destroy();
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("target request timed out"));
    });
    request.once("error", (error) => {
      if (settled) return;
      reject(new PaymentOfferPreflightError(String(error?.message || error), {
        code: "target_fetch_failed",
        statusCode: 502,
      }));
    });
    request.end();
  });
}

export async function requestOpenApiDocument(target, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  lookupImpl = dnsLookup,
} = {}) {
  const openapiUrl = new URL("/openapi.json", target.origin);
  const resolved = await resolvePublicAddress(openapiUrl.hostname.replace(/^\[|\]$/g, ""), { lookupImpl });
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpsRequest(openapiUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "SameDayDesk-Payment-Offer-Preflight/1.2 (+https://samedaydesk.com)",
      },
      lookup: createPinnedLookup(resolved),
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const mediaType = String(response.headers["content-type"] || "").toLowerCase().split(";", 1)[0].trim();
      const declaredLength = Number(response.headers["content-length"]);
      if (status !== 200 || mediaType !== "application/json" ||
          (Number.isFinite(declaredLength) && declaredLength > MAX_OPENAPI_BYTES)) {
        settled = true;
        response.destroy();
        resolve(null);
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_OPENAPI_BYTES) {
          settled = true;
          response.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(null);
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("OpenAPI request timed out")));
    request.once("error", (error) => {
      if (settled) return;
      reject(new PaymentOfferPreflightError(String(error?.message || error), {
        code: "openapi_fetch_failed",
        statusCode: 502,
      }));
    });
    request.end();
  });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function responseDeclaration(document, target) {
  const operation = record(record(record(document?.paths)?.[target.pathname])?.get);
  const responses = record(operation?.responses);
  const status = Object.keys(responses || {}).filter((key) => /^2\d\d$/.test(key)).sort()[0];
  const content = record(record(responses?.[status])?.content);
  const key = Object.keys(content || {}).find((item) => item.toLowerCase().split(";", 1)[0].trim() === "application/json");
  const media = record(content?.[key]);
  if (!status || !media) return { status: 200, mediaType: "application/json", schema: null };
  const schema = record(media.schema);
  let example = media.example;
  if (example === undefined) {
    const first = Object.values(record(media.examples) || {}).find((item) => record(item)?.value !== undefined);
    example = record(first)?.value;
  }
  if (example === undefined && schema?.example !== undefined) example = schema.example;
  return {
    status: Number(status),
    mediaType: "application/json",
    schema: schema || null,
    ...(example === undefined ? {} : { example }),
  };
}

async function responseContractFor(target, openapiImpl, now) {
  let document = null;
  try {
    document = await openapiImpl(target);
  } catch {
    document = null;
  }
  return evaluateResponseContract({
    schemaVersion: SCHEMAS.responseContractObservation,
    source: document ? "seller_openapi" : "seller_openapi_unavailable",
    request: { method: "GET", url: target.toString() },
    response: document ? responseDeclaration(document, target) : { status: 200, mediaType: "application/json", schema: null },
  }, { now });
}

function headerValue(headers, name) {
  const value = headers?.get?.(name);
  if (typeof value !== "string" || !value.trim()) return null;
  if (Buffer.byteLength(value, "utf8") > MAX_HEADER_VALUE_BYTES) {
    fail(`${name} header is too large`, { code: "malformed_challenge", statusCode: 502 });
  }
  return value.trim();
}

function decimalAmount(amountAtomic, decimals) {
  if (!/^\d+$/.test(String(amountAtomic || "")) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const padded = String(amountAtomic).padStart(decimals + 1, "0");
  if (decimals === 0) return padded;
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeX402(header, target, findings, now) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    findings.push({ severity: "error", code: "x402_malformed", message: "PAYMENT-REQUIRED is not valid base64 JSON." });
    return [];
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.x402Version !== 2) {
    findings.push({ severity: "error", code: "x402_unsupported", message: "PAYMENT-REQUIRED is not an x402 v2 object." });
    return [];
  }
  let resourceMatches = false;
  try {
    resourceMatches = normalizePaymentTarget(payload.resource?.url).toString() === target.toString();
  } catch {
    resourceMatches = false;
  }
  if (!resourceMatches) {
    findings.push({ severity: "error", code: "x402_resource_mismatch", message: "The x402 resource URL does not bind to the requested URL." });
  }
  const accepts = Array.isArray(payload.accepts) ? payload.accepts.slice(0, 20) : [];
  return accepts.map((offer, index) => {
    const scheme = cleanString(offer?.scheme, 40);
    const network = cleanString(offer?.network, 100);
    const asset = cleanString(offer?.asset, 200);
    const amountAtomic = /^\d+$/.test(String(offer?.amount || "")) && BigInt(offer.amount) > 0n ? String(offer.amount) : null;
    const recipient = cleanString(offer?.payTo, 200);
    const maxTimeoutSeconds = Number(offer?.maxTimeoutSeconds);
    const expiresAt = Number.isInteger(maxTimeoutSeconds) && maxTimeoutSeconds > 0 && maxTimeoutSeconds <= 86_400
      ? new Date(now + maxTimeoutSeconds * 1_000).toISOString()
      : null;
    const valid = Boolean(resourceMatches && scheme && network && asset && amountAtomic && recipient && expiresAt);
    if (!valid) findings.push({ severity: "error", code: "x402_offer_invalid", message: `x402 offer ${index} is incomplete or invalid.` });
    return {
      protocol: "x402",
      scheme,
      intent: "exact",
      network,
      asset,
      amountAtomic,
      decimals: null,
      amountDisplay: null,
      recipient,
      expiresAt,
      valid,
    };
  });
}

function normalizeMpp(header, target, findings, now) {
  let challenges;
  try {
    challenges = Challenge.deserializeList(header);
  } catch {
    findings.push({ severity: "error", code: "mpp_malformed", message: "WWW-Authenticate does not contain a parseable MPP Payment challenge." });
    return [];
  }
  return challenges.slice(0, 20).map((challenge, index) => {
    const request = challenge?.request && typeof challenge.request === "object" ? challenge.request : {};
    const methodDetails = request.methodDetails && typeof request.methodDetails === "object" ? request.methodDetails : {};
    const method = cleanString(challenge?.method, 40);
    const intent = cleanString(challenge?.intent, 40);
    const realm = cleanString(challenge?.realm, 255);
    const amountAtomic = /^\d+$/.test(String(request.amount || "")) && BigInt(request.amount) > 0n ? String(request.amount) : null;
    const asset = cleanString(request.currency, 200);
    const recipient = cleanString(request.recipient, 200);
    const chainId = Number.isSafeInteger(Number(methodDetails.chainId)) && Number(methodDetails.chainId) > 0
      ? Number(methodDetails.chainId)
      : null;
    const decimals = Number.isInteger(Number(methodDetails.decimals)) && Number(methodDetails.decimals) >= 0 && Number(methodDetails.decimals) <= 30
      ? Number(methodDetails.decimals)
      : null;
    const expiresAt = cleanString(challenge?.expires, 100);
    const expiryMs = expiresAt ? Date.parse(expiresAt) : null;
    const expired = Number.isFinite(expiryMs) && expiryMs <= now;
    const realmMatches = realm === target.host;
    const valid = Boolean(method && intent && realmMatches && amountAtomic && asset && recipient && Number.isFinite(expiryMs) && !expired);
    if (!realmMatches) findings.push({ severity: "error", code: "mpp_realm_mismatch", message: `MPP challenge ${index} realm does not match the target host.` });
    if (expired) findings.push({ severity: "error", code: "mpp_expired", message: `MPP challenge ${index} is expired.` });
    if (!valid && realmMatches && !expired) findings.push({ severity: "error", code: "mpp_offer_invalid", message: `MPP challenge ${index} is incomplete or invalid.` });
    return {
      protocol: "mpp",
      scheme: method,
      intent,
      network: chainId ? `eip155:${chainId}` : null,
      asset,
      amountAtomic,
      decimals,
      amountDisplay: decimalAmount(amountAtomic, decimals),
      recipient,
      expiresAt,
      realm,
      credentialTypes: Array.isArray(methodDetails.credentialTypes)
        ? methodDetails.credentialTypes.map((value) => cleanString(value, 80)).filter(Boolean).slice(0, 10)
        : [],
      valid,
    };
  });
}

function parity(validOffers) {
  const protocols = new Set(validOffers.map((offer) => offer.protocol));
  if (protocols.size < 2) return { compared: false, consistent: null, driftFields: [] };
  const fields = ["amountAtomic", "asset", "recipient", "network"];
  const driftFields = fields.filter((field) => {
    const values = validOffers.map((offer) => String(offer[field] || "").toLowerCase()).filter(Boolean);
    return values.length > 1 && new Set(values).size > 1;
  });
  return { compared: true, consistent: driftFields.length === 0, driftFields };
}

export async function paymentOfferPreflight(input, {
  now = Date.now(),
  requestImpl = requestPaymentHeaders,
  openapiImpl = requestOpenApiDocument,
} = {}) {
  const normalizedInput = normalizePaymentOfferPreflightInput(input);
  const target = normalizePaymentTarget(normalizedInput.url);
  const response = await requestImpl(target);
  const responseContract = await responseContractFor(target, openapiImpl, now);
  const status = Number(response?.status || 0);
  const findings = [];
  if (response?.finalUrl && normalizePaymentTarget(response.finalUrl).toString() !== target.toString()) {
    fail("target redirected to a different URL", { code: "redirect_rejected", statusCode: 502 });
  }
  if (status !== 402) {
    findings.push({ severity: "warning", code: "expected_402_missing", message: `The credential-free request returned HTTP ${status || "unknown"}, not 402.` });
  }

  const offers = [];
  const x402Header = headerValue(response?.headers, "payment-required");
  if (x402Header) offers.push(...normalizeX402(x402Header, target, findings, now));
  const mppHeader = headerValue(response?.headers, "www-authenticate");
  if (mppHeader && /(?:^|,)\s*Payment\s/i.test(mppHeader)) {
    offers.push(...normalizeMpp(mppHeader, target, findings, now));
  }
  if (!x402Header && !(mppHeader && /(?:^|,)\s*Payment\s/i.test(mppHeader))) {
    findings.push({ severity: "warning", code: "payment_offer_missing", message: "No x402 or MPP payment challenge was advertised." });
  }

  const validOffers = offers.filter((offer) => offer.valid);
  const economicParity = parity(validOffers);
  if (economicParity.compared && !economicParity.consistent) {
    findings.push({ severity: "error", code: "protocol_economic_drift", message: `Protocols differ on ${economicParity.driftFields.join(", ")}.` });
  }
  const catalogComparableOffers = normalizedInput.catalog?.protocol
    ? validOffers.filter((offer) => offer.protocol === normalizedInput.catalog.protocol)
    : validOffers;
  const catalogCoherence = normalizedInput.catalog
    ? (catalogComparableOffers.length ? catalogComparableOffers : validOffers).map((offer) => evaluateOfferCoherence({
      catalog: normalizedInput.catalog,
      runtime: {
        protocol: offer.protocol,
        method: "GET",
        url: target.toString(),
        amountAtomic: offer.amountAtomic,
        network: offer.network,
        asset: offer.asset,
        recipient: offer.recipient,
        expiresAt: offer.expiresAt,
      },
    }, { now }))
    : [];
  if (catalogCoherence.some((report) => report.decision === "drifted")) {
    findings.push({ severity: "error", code: "catalog_runtime_offer_drift", message: "At least one live offer differs from the supplied catalog candidate." });
  } else if (catalogCoherence.some((report) => report.decision === "partial")) {
    findings.push({ severity: "warning", code: "catalog_runtime_offer_partial", message: "The supplied catalog candidate omits terms needed to establish complete coherence." });
  }
  if (responseContract.decision !== "admissible") {
    findings.push({
      severity: "warning",
      code: `seller_response_contract_${responseContract.decision}`,
      message: "The exact route lacks an admissible self-contained JSON success-response contract.",
    });
  }
  const hasError = findings.some((finding) => finding.severity === "error");
  const decision = status !== 402 || validOffers.length === 0
    ? "no_parseable_offer"
    : hasError || responseContract.decision !== "admissible"
      ? "review_required"
      : "parseable_offer";

  return {
    ok: true,
    product: "samedaydesk-payment-offer-preflight",
    version: "1.2.0",
    checkedAt: new Date(now).toISOString(),
    target: { method: "GET", url: target.toString(), httpStatus: status },
    decision,
    protocols: [...new Set(validOffers.map((offer) => offer.protocol))].sort(),
    offerCount: validOffers.length,
    offers,
    parity: economicParity,
    catalogCoherence,
    responseContract,
    responseContractAcquisition: {
      attempted: true,
      sameOrigin: true,
      path: "/openapi.json",
      maxBytes: MAX_OPENAPI_BYTES,
      documentRead: responseContract.source === "seller_openapi",
      targetResponseBodyRead: false,
      credentialsUsed: false,
      redirectsFollowed: false,
    },
    findings,
    boundary: {
      credentialsUsed: false,
      paymentSigned: false,
      paymentSent: false,
      targetResponseBodyRead: false,
      openApiDocumentRead: responseContract.source === "seller_openapi",
      redirectsFollowed: false,
      claim: "Seller-declared response contracts are advisory. Parseable terms and schemas do not prove trust, utility, runtime validity, or settlement.",
    },
  };
}

export { publicAddress };
