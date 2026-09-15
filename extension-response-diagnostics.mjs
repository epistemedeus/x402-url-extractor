/**
 * Allowlisted EXTENSION-RESPONSES diagnostics for CDP Bazaar indexing.
 *
 * Official docs: the facilitator MAY return a base64 JSON object keyed by
 * extension name. The bazaar key carries status success|processing|rejected.
 * @x402/core HTTPFacilitatorClient 2.16.0 logs an allowlisted subset on
 * success responses and swallows decode errors, which conflates absent, empty,
 * malformed, and `{}`. This module distinguishes those states and never dumps
 * payloads, signatures, or credentials.
 *
 * Missing telemetry (no verify/settle observed) stays `unknown`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const EXTENSION_RESPONSES_HEADER = "EXTENSION-RESPONSES";
export const BAZAAR_KEY = "bazaar";
export const BAZAAR_STATUSES = Object.freeze(["success", "processing", "rejected"]);
export const HEADER_STATES = Object.freeze(["absent", "empty", "malformed", "decoded", "unknown"]);
export const ALLOWLISTED_BAZAAR_FIELDS = Object.freeze(["status", "rejectedReason"]);
export const MAX_REJECTED_REASON_CHARS = 200;

const UNKNOWN = Object.freeze({
  headerState: "unknown",
  decoded: false,
  bazaarStatus: "unknown",
  bazaarRejectedReasonPresent: false,
  extensionKeys: Object.freeze([]),
});

/** @type {null | { at: string, phase: string, verify: object, settle: object }} */
let lastDiagnostic = null;
const phaseStore = new AsyncLocalStorage();
let fetchHookInstalled = false;
let wrappedFetch = null;

function freezeClassification(row) {
  return Object.freeze({
    headerState: row.headerState,
    decoded: row.decoded === true,
    bazaarStatus: row.bazaarStatus,
    bazaarRejectedReasonPresent: row.bazaarRejectedReasonPresent === true,
    extensionKeys: Object.freeze([...(row.extensionKeys || [])]),
    ...(row.bazaarStatus === "rejected" && typeof row.rejectedReasonPreview === "string"
      ? { rejectedReasonPreview: row.rejectedReasonPreview }
      : {}),
  });
}

export function unknownExtensionResponseClassification() {
  return freezeClassification(UNKNOWN);
}

function previewRejectedReason(value) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, MAX_REJECTED_REASON_CHARS);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strict-enough base64 (standard or URL-safe) to JSON object.
 * Invalid padding/alphabet, non-JSON, and non-objects are malformed.
 */
function decodeBase64Object(value) {
  const compact = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!compact) return { error: "empty" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return { error: "malformed" };
  if (compact.length % 4 === 1) return { error: "malformed" };
  let text;
  try {
    text = Buffer.from(compact, "base64").toString("utf8");
  } catch {
    return { error: "malformed" };
  }
  if (!text) return { error: "malformed" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "malformed" };
  }
  if (!isPlainObject(parsed)) return { error: "malformed" };
  return { value: parsed };
}

/**
 * Classify a raw EXTENSION-RESPONSES header value.
 * @param {unknown} headerValue `null`/`undefined` = absent; `""`/whitespace = empty.
 */
export function classifyExtensionResponsesHeader(headerValue) {
  if (headerValue === null || headerValue === undefined) {
    return freezeClassification({
      headerState: "absent",
      decoded: false,
      bazaarStatus: "unknown",
      bazaarRejectedReasonPresent: false,
      extensionKeys: [],
    });
  }
  if (typeof headerValue !== "string") {
    return freezeClassification({
      headerState: "malformed",
      decoded: false,
      bazaarStatus: "unknown",
      bazaarRejectedReasonPresent: false,
      extensionKeys: [],
    });
  }
  if (headerValue.trim() === "") {
    return freezeClassification({
      headerState: "empty",
      decoded: false,
      bazaarStatus: "unknown",
      bazaarRejectedReasonPresent: false,
      extensionKeys: [],
    });
  }
  const decoded = decodeBase64Object(headerValue);
  if (decoded.error) {
    return freezeClassification({
      headerState: "malformed",
      decoded: false,
      bazaarStatus: "unknown",
      bazaarRejectedReasonPresent: false,
      extensionKeys: [],
    });
  }
  const keys = Object.keys(decoded.value).sort();
  const bazaar = Object.prototype.hasOwnProperty.call(decoded.value, BAZAAR_KEY)
    ? decoded.value[BAZAAR_KEY]
    : undefined;
  if (bazaar === undefined) {
    return freezeClassification({
      headerState: "decoded",
      decoded: true,
      bazaarStatus: "unknown",
      bazaarRejectedReasonPresent: false,
      extensionKeys: keys,
    });
  }
  if (!isPlainObject(bazaar)) {
    return freezeClassification({
      headerState: "decoded",
      decoded: true,
      bazaarStatus: "unknown",
      bazaarRejectedReasonPresent: false,
      extensionKeys: keys,
    });
  }
  const status = BAZAAR_STATUSES.includes(bazaar.status) ? bazaar.status : "unknown";
  const reason = previewRejectedReason(bazaar.rejectedReason);
  return freezeClassification({
    headerState: "decoded",
    decoded: true,
    bazaarStatus: status,
    bazaarRejectedReasonPresent: Boolean(reason),
    extensionKeys: keys,
    ...(status === "rejected" && reason ? { rejectedReasonPreview: reason } : {}),
  });
}

export function encodeExtensionResponsesHeader(body) {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

export function readExtensionResponsesHeader(headers) {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    const value = headers.get(EXTENSION_RESPONSES_HEADER);
    return value === null || value === undefined ? null : value;
  }
  if (typeof headers === "object") {
    const direct = headers[EXTENSION_RESPONSES_HEADER] ?? headers["extension-responses"];
    if (direct === undefined) return null;
    return Array.isArray(direct) ? direct[0] : direct;
  }
  return null;
}

function facilitatorPhaseFromUrl(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path.endsWith("/verify")) return "verify";
    if (path.endsWith("/settle")) return "settle";
    return null;
  } catch {
    return null;
  }
}

function installFetchHook() {
  if (fetchHookInstalled) return;
  fetchHookInstalled = true;
  const inner = globalThis.fetch.bind(globalThis);
  wrappedFetch = async (input, init) => {
    const response = await inner(input, init);
    const slot = phaseStore.getStore();
    if (!slot) return response;
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input && typeof input === "object" && "url" in input
          ? String(input.url)
          : "";
    const phase = facilitatorPhaseFromUrl(url);
    if (!phase) return response;
    slot[phase] = classifyExtensionResponsesHeader(readExtensionResponsesHeader(response.headers));
    return response;
  };
  globalThis.fetch = wrappedFetch;
}

function recordPhase(phase, slot) {
  const classification = slot?.[phase] || unknownExtensionResponseClassification();
  const previous = lastDiagnostic;
  lastDiagnostic = {
    at: new Date().toISOString(),
    phase,
    verify: phase === "verify"
      ? classification
      : previous?.verify || unknownExtensionResponseClassification(),
    settle: phase === "settle"
      ? classification
      : previous?.settle || unknownExtensionResponseClassification(),
  };
}

export function getLastExtensionResponseDiagnostic() {
  if (!lastDiagnostic) {
    return {
      at: null,
      phase: null,
      verify: unknownExtensionResponseClassification(),
      settle: unknownExtensionResponseClassification(),
    };
  }
  return {
    at: lastDiagnostic.at,
    phase: lastDiagnostic.phase,
    verify: lastDiagnostic.verify,
    settle: lastDiagnostic.settle,
  };
}

export function resetExtensionResponseDiagnosticsForTests() {
  lastDiagnostic = null;
}

/**
 * Wrap a facilitator client so verify/settle classify EXTENSION-RESPONSES.
 * Pass-through otherwise. Concurrent-safe via AsyncLocalStorage. Does not
 * change request bodies, signatures, or payment outcomes.
 *
 * @param {object} client
 */
export function wrapFacilitatorClientForExtensionResponseDiagnostics(client) {
  if (!client || typeof client !== "object") return client;
  installFetchHook();
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === "verify" || key === "settle") {
        return async (...args) => {
          const slot = { verify: null, settle: null };
          try {
            return await phaseStore.run(slot, () => target[key](...args));
          } finally {
            recordPhase(key, slot);
          }
        };
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export { UNKNOWN as UNKNOWN_EXTENSION_RESPONSE };
