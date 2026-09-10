import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Hex(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function sha256File(path) {
  return sha256Hex(readFileSync(path));
}

export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && value !== null) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

export function uniqueStrings(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    if (item == null) continue;
    const text = typeof item === "string" ? item : String(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}
