import { createHash, randomBytes } from "node:crypto";

export function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

/** Canonical JSON digest shared with E08 artifact checks. */
export function digestValue(value) {
  return createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");
}

export function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(sortValue(value)));
}

export function newId(prefix) {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

export function jobId() {
  return `j${randomBytes(16).toString("hex")}`;
}
