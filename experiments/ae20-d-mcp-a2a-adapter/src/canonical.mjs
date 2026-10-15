import { createHash } from "node:crypto";

export function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(sortValue(value)));
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digestBytes(bytes) {
  return sha256(bytes);
}

export function digestValue(value) {
  return digestBytes(canonicalBytes(value));
}
