import { DIGEST_HEX_RE } from "./digest.mjs";

export const HISTORICAL_V1 = 1;
export const HISTORICAL_VALIDATOR_VERDICT = "not_checked";
export const HISTORICAL_VALIDATOR_AUTHORITY = "none";
export const HISTORICAL_VALIDATOR_SOURCE = "http_runtime_not_checked";
export const HISTORICAL_RUNTIME_ATTRIBUTION = "http";
export const PAID_EVIDENCE_FILENAME = "commerce-paid-success-evidence.ndjson";

export const HISTORICAL_V1_REQUIRED_KEYS = Object.freeze([
  "credentialFingerprint",
  "id",
  "method",
  "originClass",
  "payerClass",
  "paymentProtocol",
  "requestDigest",
  "requestStartedAt",
  "responseDigest",
  "responseFinishedAt",
  "route",
  "runtimeAttribution",
  "settlementReference",
  "source",
  "v",
  "validatorAuthority",
  "validatorSource",
  "validatorVerdict",
]);

const PAYMENT_CLASSES = new Set([
  "internal",
  "validation",
  "incentivized",
  "affiliated",
  "independent",
]);

export const PAID_EVIDENCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_RE = PAID_EVIDENCE_ID_PATTERN;
const METHOD_RE = /^[A-Z][A-Z0-9-]{0,15}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Admit historical v1 paid-success rows even if a later merchant constant
 * equals "validated". Old not_checked rows remain historical. Extra keys
 * (optional later fields) do not drop a v1 not_checked row.
 */
export function isHistoricalV1PaidSuccess(value, options = {}) {
  void options.currentValidatorVerdict;
  if (!isPlainObject(value)) return false;
  if (value.v !== HISTORICAL_V1) return false;
  for (const key of HISTORICAL_V1_REQUIRED_KEYS) {
    if (!Object.hasOwn(value, key)) return false;
  }
  if (value.validatorVerdict !== HISTORICAL_VALIDATOR_VERDICT) return false;
  if (value.validatorAuthority !== HISTORICAL_VALIDATOR_AUTHORITY) return false;
  if (value.validatorSource !== HISTORICAL_VALIDATOR_SOURCE) return false;
  if (value.runtimeAttribution !== HISTORICAL_RUNTIME_ATTRIBUTION) return false;
  if (!UUID_RE.test(value.id)) return false;
  if (!METHOD_RE.test(value.method)) return false;
  if (typeof value.route !== "string" || !value.route.startsWith("/")) return false;
  if (!DIGEST_HEX_RE.test(value.responseDigest)) return false;
  if (!DIGEST_HEX_RE.test(value.requestDigest)) return false;
  if (!DIGEST_HEX_RE.test(value.credentialFingerprint)) return false;
  if (value.payerClass !== "unclassified" && !PAYMENT_CLASSES.has(value.payerClass)) return false;
  if (value.settlementReference !== null && !TX_RE.test(value.settlementReference)) return false;
  if (!ISO_RE.test(value.requestStartedAt) || !ISO_RE.test(value.responseFinishedAt)) return false;
  if (value.paymentProtocol !== "x402" && value.paymentProtocol !== "mpp") return false;
  return true;
}

/** Diagnostic helper only. Must not be used as join Map identity. */
export function joinKey({ method, resource, route, responseDigest }) {
  const path = resource || route;
  return `${String(method)}\0${String(path)}\0${String(responseDigest)}`;
}

export function parseNdjson(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push({ _unparseable: true, _rawLength: line.length });
    }
  }
  return rows;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
