import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

import { Challenge } from "mppx";

const MAX_URL_LENGTH = 2_048;
const MAX_HEADER_VALUE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const SENSITIVE_QUERY_KEY = /(?:^|[-_.])(api[-_.]?key|access[-_.]?token|auth|authorization|credential|password|secret|token)(?:$|[-_.])/i;

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

function normalizeX402(header, target, findings) {
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
    const valid = Boolean(resourceMatches && scheme && network && asset && amountAtomic && recipient);
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
      expiresAt: null,
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
    const valid = Boolean(method && intent && realmMatches && amountAtomic && asset && recipient && !expired);
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
} = {}) {
  const target = normalizePaymentTarget(input?.url ?? input);
  const response = await requestImpl(target);
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
  if (x402Header) offers.push(...normalizeX402(x402Header, target, findings));
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
  const hasError = findings.some((finding) => finding.severity === "error");
  const decision = status !== 402 || validOffers.length === 0
    ? "no_parseable_offer"
    : hasError
      ? "review_required"
      : "parseable_offer";

  return {
    ok: true,
    product: "samedaydesk-payment-offer-preflight",
    version: "1.0.0",
    checkedAt: new Date(now).toISOString(),
    target: { method: "GET", url: target.toString(), httpStatus: status },
    decision,
    protocols: [...new Set(validOffers.map((offer) => offer.protocol))].sort(),
    offerCount: validOffers.length,
    offers,
    parity: economicParity,
    findings,
    boundary: {
      credentialsUsed: false,
      paymentSigned: false,
      paymentSent: false,
      responseBodyRead: false,
      redirectsFollowed: false,
      claim: "Parseable payment terms are not proof that a service is trustworthy, solvent, useful, or guaranteed to settle.",
    },
  };
}

export { publicAddress };
