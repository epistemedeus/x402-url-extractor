const SECRET_KEY = /private.?key|secret|seed|mnemonic|password|credential|api.?key|authorization|signature/i;
const HEX_KEY = /\b0x[a-f0-9]{64,}\b/gi;
const OPAQUE_BLOB = /[A-Za-z0-9+/_=-]{120,}/g;

export function redactValue(value, key = "") {
  if (value == null) return value;
  if (typeof value === "string") {
    if (SECRET_KEY.test(key)) return "[redacted]";
    return value.replace(HEX_KEY, "[redacted]").replace(OPAQUE_BLOB, "[opaque-redacted]");
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactValue(v, k);
    }
    return out;
  }
  return value;
}

export function safeJson(value) {
  return JSON.stringify(redactValue(value), null, 2);
}

export function assertNoSecretMaterial(text) {
  const sample = String(text || "");
  if (/\b0x[a-f0-9]{64,}\b/i.test(sample)) {
    throw new Error("output must not contain private-key material");
  }
  if (/sk-[A-Za-z0-9]{20,}/.test(sample)) {
    throw new Error("output must not contain API key material");
  }
}
