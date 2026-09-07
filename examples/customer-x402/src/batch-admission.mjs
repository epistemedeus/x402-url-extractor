import { createHash } from "node:crypto";
import { isIP } from "node:net";

/** Matches merchant extract-batch supported fields (seller contract). */
export const BATCH_SUPPORTED_FIELDS = Object.freeze([
  "title",
  "description",
  "canonical",
  "lang",
  "openGraph",
  "twitter",
  "jsonLd",
  "headings",
  "links",
  "text",
  "aiReadiness",
]);

export const BATCH_MAX_URLS = 5;
export const BATCH_MAX_URL_LENGTH = 2048;
export const BATCH_MAX_REQUEST_JSON_BYTES = 16 * 1024;

export class BatchAdmissionError extends Error {
  constructor(message, { field = null } = {}) {
    super(message);
    this.name = "BatchAdmissionError";
    this.code = "invalid_batch_input";
    this.field = field;
  }
}

const BLOCKED_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1)$|(\.local)$|^(10\.|127\.|169\.254\.|192\.168\.|fc00:|fe80:)/i;
const BLOCKED_IPV4_172 = /^172\.(1[6-9]|2\d|3[01])\./;

function isPublicV4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

/**
 * Narrow public HTTPS admission aligned with the merchant batch route.
 * Does not fetch targets and does not authorize payment.
 */
export function assertPublicHttpsUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new BatchAdmissionError("each url must be a public HTTPS URL", { field: "urls" });
  }
  if (raw.length > BATCH_MAX_URL_LENGTH) {
    throw new BatchAdmissionError(`url exceeds ${BATCH_MAX_URL_LENGTH} characters`, { field: "urls" });
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new BatchAdmissionError("each url must be a public HTTPS URL", { field: "urls" });
  }
  if (url.protocol !== "https:") {
    throw new BatchAdmissionError("only public HTTPS URLs are accepted", { field: "urls" });
  }
  if (url.username || url.password) {
    throw new BatchAdmissionError("URL credentials unsupported", { field: "urls" });
  }
  const host = url.hostname.toLowerCase();
  if (host.includes(":")) {
    throw new BatchAdmissionError("private or IPv6 address unsupported", { field: "urls" });
  }
  if (isIP(host) && !isPublicV4(host)) {
    throw new BatchAdmissionError("private/non-public host blocked", { field: "urls" });
  }
  if (BLOCKED_HOST_RE.test(host) || BLOCKED_IPV4_172.test(host)) {
    throw new BatchAdmissionError("private/loopback host blocked", { field: "urls" });
  }
  if (url.href.length > BATCH_MAX_URL_LENGTH) {
    throw new BatchAdmissionError("normalized url exceeds length limit", { field: "urls" });
  }
  return url.href;
}

const ALLOWED_BODY_KEYS = new Set(["urls", "fields"]);

/**
 * Pure local admission for POST /extract/batch. Fetching a payment challenge
 * alone is not application validity; call this before any unpaid or paid fetch.
 */
export function admitExtractBatchBody(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new BatchAdmissionError("request body must be a JSON object", { field: "body" });
  }
  const extra = Object.keys(body).filter((key) => !ALLOWED_BODY_KEYS.has(key));
  if (extra.length) {
    throw new BatchAdmissionError(`unexpected field: ${extra[0]}`, { field: extra[0] });
  }
  if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > BATCH_MAX_URLS) {
    throw new BatchAdmissionError(
      `urls must be an array of 1 to ${BATCH_MAX_URLS} public HTTPS URLs`,
      { field: "urls" },
    );
  }
  const urls = Object.freeze(Array.from(body.urls, (value) => assertPublicHttpsUrl(value)));
  let fields;
  if (body.fields === undefined) {
    fields = Object.freeze([...BATCH_SUPPORTED_FIELDS]);
  } else {
    if (!Array.isArray(body.fields) || body.fields.length < 1 ||
        body.fields.length > BATCH_SUPPORTED_FIELDS.length ||
        new Set(body.fields).size !== body.fields.length) {
      throw new BatchAdmissionError("fields must be a non-empty unique bounded array", { field: "fields" });
    }
    for (const field of body.fields) {
      if (!BATCH_SUPPORTED_FIELDS.includes(field)) {
        throw new BatchAdmissionError("unsupported extraction requirement field", { field: "fields" });
      }
    }
    fields = Object.freeze([...body.fields]);
  }
  const bodyRaw = JSON.stringify({ urls: [...urls], fields: [...fields] });
  const bodyBytes = Buffer.byteLength(bodyRaw);
  if (bodyBytes > BATCH_MAX_REQUEST_JSON_BYTES) {
    throw new BatchAdmissionError(
      `request JSON exceeds the ${BATCH_MAX_REQUEST_JSON_BYTES} byte ceiling`,
      { field: "body" },
    );
  }
  return Object.freeze({
    urls,
    fields,
    bodyRaw,
    bodyBytes,
    bodyDigest: bodyDigestFor(bodyRaw),
  });
}

export function bodyDigestFor(bodyRaw) {
  return `sha256:${createHash("sha256").update(String(bodyRaw)).digest("hex")}`;
}

export function assertExactBodyBytes(authorizedRaw, candidate) {
  const expected = Buffer.from(String(authorizedRaw));
  let actual;
  if (typeof candidate === "string" || Buffer.isBuffer(candidate) || candidate instanceof Uint8Array) {
    actual = Buffer.from(candidate);
  } else if (candidate instanceof ArrayBuffer) {
    actual = Buffer.from(candidate);
  } else {
    throw new BatchAdmissionError("request body must be exact authorized bytes", { field: "body" });
  }
  if (actual.length !== expected.length || !actual.equals(expected)) {
    throw new BatchAdmissionError("request body bytes do not match the authorized binding", { field: "body" });
  }
  return actual;
}
