const SECRET_KEY = /private.?key|secret|seed|mnemonic|password|credential|signature|authorization|x.?payment/i;
const HEX_KEY = /\b0x[a-f0-9]{64,}\b/gi;
const PAYMENT_HEADER_BLOB = /\b(?:PAYMENT-SIGNATURE|X-PAYMENT|PAYMENT-REQUIRED|PAYMENT-RESPONSE)\b[^A-Za-z0-9+/=_-]*[A-Za-z0-9+/=_-]{24,}/gi;

export function redactValue(value, key = "") {
  if (value == null) return value;
  if (typeof value === "string") {
    if (SECRET_KEY.test(key)) return "[redacted]";
    return value.replace(HEX_KEY, "[redacted]").replace(PAYMENT_HEADER_BLOB, "[payment-header-redacted]");
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
