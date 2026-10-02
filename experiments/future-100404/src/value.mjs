import { createHash } from "node:crypto";

export const MAX_INPUT_BYTES = 160 * 1024;
export const MAX_RECEIPT_BYTES = 1024 * 1024;
export function fail(code) { throw Object.assign(new Error(code), { code }); }
export function assert(ok, code) { if (!ok) fail(code); }
export function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function keys(value, allowed, required = allowed) {
  assert(object(value), "object_required");
  assert(Object.keys(value).every(key => allowed.includes(key)), "unknown_field");
  assert(required.every(key => Object.hasOwn(value, key)), "missing_field");
}
export function checkedJson(value, max = MAX_INPUT_BYTES) {
  let nodes = 0;
  function walk(v, depth) {
    assert(++nodes <= 20000 && depth <= 24, "json_complexity");
    if (v === null || typeof v === "boolean" || typeof v === "string") return;
    if (typeof v === "number") { assert(Number.isFinite(v), "invalid_number"); return; }
    assert(Array.isArray(v) || object(v), "json_required");
    for (const key of Object.keys(v)) {
      assert(!["__proto__", "prototype", "constructor"].includes(key), "unsafe_key");
      walk(v[key], depth + 1);
    }
  }
  walk(value, 0);
  const text = JSON.stringify(value);
  assert(Buffer.byteLength(text) <= max, "input_bytes_exceeded");
  return JSON.parse(text);
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function digest(value) { return hash(JSON.stringify(canonical(value))); }
export function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
export function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function time(value) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    ? Date.parse(value) : NaN;
}
export function pointer(root, path) {
  assert(typeof path === "string" && path.startsWith("/") && path.length <= 240, "bad_pointer");
  const bits = path.slice(1).split("/");
  assert(bits.length <= 12 && bits.every(bit => !/~(?![01])/.test(bit)), "bad_pointer");
  let value = root;
  for (const raw of bits) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    assert(!["__proto__", "prototype", "constructor"].includes(key), "unsafe_pointer");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return { present: false };
    value = value[key];
  }
  return { present: true, value };
}
