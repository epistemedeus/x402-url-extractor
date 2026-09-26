const PAYMENT_HEADER_NAMES = Object.freeze([
  "authorization",
  "payment-signature",
  "payment-required",
  "payment-response",
  "x-payment",
  "x-payment-signature",
]);

export function decodeMcpBody(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payload = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("");
    return payload ? JSON.parse(payload) : null;
  }
  return JSON.parse(text);
}

export function headerMap(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === "function") {
    headers.forEach((value, name) => {
      out[String(name).toLowerCase()] = String(value);
    });
    return out;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    out[String(name).toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return out;
}

export function requestHadPayment(headers) {
  const map = headerMap(headers);
  return PAYMENT_HEADER_NAMES.some((name) => {
    const value = map[name];
    return typeof value === "string" && value.length > 0;
  });
}

export function responseHadPaymentChallenge(headers) {
  const map = headerMap(headers);
  return Boolean(map["payment-required"] || map["www-authenticate"]);
}
