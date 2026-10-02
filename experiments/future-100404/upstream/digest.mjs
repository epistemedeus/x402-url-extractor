import { createHash } from "node:crypto";

/** Exact merchant domain from x402-url-extractor commerce-events.mjs at a143898d. */
export const RESPONSE_DIGEST_DOMAIN =
  "samedaydesk.commerce-paid-success-evidence.response.v1\0";

export const DIGEST_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Digest of the exact response bytes the caller observed.
 * Matches merchant capturePaidEvidenceResponseDigest for a transferred body:
 * SHA-256(domain || concatenated write/end chunks) with no length framing.
 */
export function digestResponseBytes(bytes) {
  const buffer = asBytes(bytes);
  const hash = createHash("sha256");
  hash.update(RESPONSE_DIGEST_DOMAIN, "utf8");
  hash.update(buffer);
  return hash.digest("hex");
}

export function asBytes(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  throw new Error("response bytes must be a Buffer, Uint8Array, or utf8 string");
}

export function isDigestHex(value) {
  return typeof value === "string" && DIGEST_HEX_RE.test(value);
}
