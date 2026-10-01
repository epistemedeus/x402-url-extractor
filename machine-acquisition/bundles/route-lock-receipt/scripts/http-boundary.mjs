import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { describedByUrls, serviceDescUrls } from "./map-challenge.mjs";

export const MAX_BODY_BYTES = 1048576;
const LOOKUP_MS = 5000;
const LOCAL_HOST = /(?:^|\.)(?:localhost|local|internal|home|lan|home\.arpa|localdomain)$/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stripBrackets(hostname) {
  return String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
}

function ipv4Parts(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

// Classification of an address literal. This is not a claim that a later
// connection stayed on that address.
export function isPublicAddress(ip) {
  let value = stripBrackets(ip);
  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);
  const v4 = ipv4Parts(value);
  if (v4) {
    const [a, b, c] = v4;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }
  if (!value.includes(":")) return false;
  if (value === "::" || value === "::1") return false;
  if (value.startsWith("fc") || value.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(value)) return false;
  if (value.startsWith("ff")) return false;
  if (value.startsWith("2001:db8")) return false;
  return true;
}

function verdict(ok, code, basis, dnsChecked) {
  return {
    ok,
    code: ok ? null : code,
    basis,
    dnsChecked,
    connectionPinned: false,
    confinementClaim: "none",
  };
}

export async function assessDestination(target, lookup = dnsLookup) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return verdict(false, "refused_url", "url", false);
  }
  if (url.protocol !== "https:" || url.hash) return verdict(false, "refused_url", "url", false);
  if (url.username || url.password) return verdict(false, "credential_rejected", "url", false);
  const host = stripBrackets(url.hostname);
  if (!host) return verdict(false, "refused_url", "url", false);
  if (isIP(host)) {
    return isPublicAddress(host)
      ? verdict(true, null, "literal-address", false)
      : verdict(false, "private_destination", "literal-address", false);
  }
  if (!host.includes(".") || LOCAL_HOST.test(host) || !/[a-z]/i.test(host)) {
    return verdict(false, "private_destination", "name-shape", false);
  }
  let records;
  try {
    records = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        setTimeout(() => reject(fail("destination_unresolved", "destination lookup timed out")), LOOKUP_MS);
      }),
    ]);
  } catch {
    return verdict(false, "destination_unresolved", "dns-lookup", true);
  }
  const list = Array.isArray(records) ? records : [records];
  const addresses = list.map((record) => record?.address).filter(Boolean);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    return verdict(false, "private_destination", "dns-lookup", true);
  }
  return verdict(true, null, "dns-lookup", true);
}

export async function readBoundedBody(response, maxBytes) {
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    if (!/^\d+$/.test(declared) || Number(declared) > maxBytes) {
      await response.body?.cancel?.().catch(() => {});
      throw fail("oversized_input", "response body exceeds the byte limit");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const buffered = Buffer.from(await response.arrayBuffer());
    if (buffered.length > maxBytes) throw fail("oversized_input", "response body exceeds the byte limit");
    return buffered;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw fail("oversized_input", "response body exceeds the byte limit");
      }
      chunks.push(Buffer.from(step.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, total);
}

export function sameOriginTarget(target, requestUrl) {
  let requested;
  try {
    requested = new URL(requestUrl);
  } catch {
    return null;
  }
  if (requested.protocol !== "https:" || requested.username || requested.password || requested.hash) return null;
  let url;
  try {
    url = new URL(target, requested);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  if (url.origin !== requested.origin) return null;
  return url.toString();
}

export async function unpaidGet(url, {
  fetchImpl = globalThis.fetch,
  lookup = dnsLookup,
  maxBytes = MAX_BODY_BYTES,
  timeoutMs = 15000,
  userAgent = "route-release-decision/0.1.0 (unpaid-get)",
} = {}) {
  const destination = await assessDestination(url, lookup);
  if (!destination.ok) throw fail(destination.code, "challenge destination was refused before a request");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw fail("refused_url", "challenge URL must be absolute https");
  }
  const response = await fetchImpl(parsed.toString(), {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      "user-agent": userAgent,
    },
  });
  const observedAtFallback = new Date().toISOString();
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel?.().catch(() => {});
    return {
      requestUrl: parsed.toString(),
      finalUrl: parsed.toString(),
      redirected: true,
      location: response.headers.get("location"),
      status: response.status,
      headers: {},
      body: null,
      observedAtFallback,
      destination,
    };
  }
  const buffer = await readBoundedBody(response, maxBytes);
  let body = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("json") || buffer[0] === 0x7b) {
    try {
      body = JSON.parse(buffer.toString("utf8"));
    } catch {
      body = null;
    }
  }
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return {
    requestUrl: parsed.toString(),
    finalUrl: response.url || parsed.toString(),
    redirected: false,
    status: response.status,
    headers,
    body,
    observedAtFallback,
    destination,
  };
}

async function captureLinked(target, requestUrl, options) {
  const normalized = sameOriginTarget(target, requestUrl);
  if (!normalized) return { url: target, status: null, body: null, redirected: false, error: "origin_mismatch" };
  try {
    const extra = await unpaidGet(normalized, options);
    return {
      url: normalized,
      status: extra.status,
      body: extra.redirected ? null : extra.body,
      redirected: extra.redirected === true,
      location: extra.location || null,
    };
  } catch (error) {
    return { url: normalized, status: null, body: null, redirected: false, error: error.code || "linked_document_failed" };
  }
}

export async function captureChallenge(url, options = {}) {
  const primary = await unpaidGet(url, options);
  const describedBy = [];
  const serviceDescriptions = [];
  if (primary.redirected) return { ...primary, describedBy, serviceDescriptions };
  for (const target of describedByUrls(primary.headers?.link).slice(0, 1)) {
    describedBy.push(await captureLinked(target, primary.requestUrl, options));
  }
  for (const target of serviceDescUrls(primary.headers?.link).slice(0, 3)) {
    serviceDescriptions.push(await captureLinked(target, primary.requestUrl, options));
  }
  return { ...primary, describedBy, serviceDescriptions };
}
