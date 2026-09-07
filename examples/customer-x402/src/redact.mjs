const SECRET_KEY = /private.?key|secret|seed|mnemonic|password|credential|signature|authorization|x.?payment/i;
const HEX_KEY = /\b0x[a-f0-9]{64,}\b/gi;
const OPAQUE_BLOB = /[A-Za-z0-9+/_=-]{100,}/g;
const PAYMENT_HEADER_BLOB = /\b(?:PAYMENT-SIGNATURE|X-PAYMENT|PAYMENT-REQUIRED|PAYMENT-RESPONSE)\b[^A-Za-z0-9+/=_-]*[A-Za-z0-9+/=_-]{24,}/gi;

export function redactValue(value, key = "") {
  if (value == null) return value;
  if (typeof value === "string") {
    if (SECRET_KEY.test(key) || (/private/i.test(key) && HEX_KEY.test(value))) return "[redacted]";
    return value.replace(HEX_KEY, "[redacted]").replace(PAYMENT_HEADER_BLOB, "[payment-header-redacted]").replace(OPAQUE_BLOB, "[opaque-redacted]");
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
    throw new Error("log output must not contain private-key material");
  }
}
