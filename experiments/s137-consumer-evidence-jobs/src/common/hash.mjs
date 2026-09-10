import { createHash } from "node:crypto";

export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** True when value is 64 lowercase hex chars. */
export function isSha256Hex(value) {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/** Stable SHA-256 hex of a string or Buffer. Shared by artifact schemas. */
export function sha256Hex(value) {
  const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return createHash("sha256").update(buf).digest("hex");
}

/** SHA-256 hex of String(text) as UTF-8. */
export function sha256Text(text) {
  return sha256Hex(String(text));
}

/** Deterministic JSON stringify with sorted object keys (arrays keep order). */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

export function sha256Canonical(value) {
  return sha256Hex(canonicalJson(value));
}
