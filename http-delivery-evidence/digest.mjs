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

/** Distinct from the HTTP response domain so an MCP payload is not an HTTP body. */
export const MCP_PAYLOAD_DIGEST_DOMAIN = "samedaydesk.mcp-tool-delivery.payload.v1\0";
const MCP_CALL_DIGEST_DOMAIN = "samedaydesk.mcp-tool-delivery.call.v1\0";
const MCP_BINDING_DIGEST_DOMAIN = "samedaydesk.mcp-tool-delivery.binding.v1\0";

export function digestMcpPayload(bytes) {
  const buffer = asBytes(bytes);
  const hash = createHash("sha256");
  hash.update(MCP_PAYLOAD_DIGEST_DOMAIN, "utf8");
  hash.update(buffer);
  return hash.digest("hex");
}

function updateLengthFramed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function canonicalCallText(id) {
  if (typeof id === "string") return id;
  if (typeof id === "number" && Number.isSafeInteger(id)) return String(id);
  return "";
}

/** Identity of the JSON-RPC call. The raw id is not required on the journal row. */
export function digestMcpCallId(id) {
  const hash = createHash("sha256");
  hash.update(MCP_CALL_DIGEST_DOMAIN, "utf8");
  updateLengthFramed(hash, canonicalCallText(id));
  return hash.digest("hex");
}

/** Tool, call, and issued offer only. Arguments are not inputs. */
export function digestMcpDeliveryBinding({ tool, callDigest, issuedOfferDigest } = {}) {
  const hash = createHash("sha256");
  hash.update(MCP_BINDING_DIGEST_DOMAIN, "utf8");
  updateLengthFramed(hash, tool || "");
  updateLengthFramed(hash, callDigest || "");
  updateLengthFramed(hash, issuedOfferDigest || "");
  return hash.digest("hex");
}
