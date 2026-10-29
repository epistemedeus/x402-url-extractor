// Field projection for one reader task. fetchedAt changes with the clock.
// MCP adds charged:false. Direct HTTP success bodies omit charged.

export const READER_FIELD_KEYS = Object.freeze([
  "ok",
  "requestedUrl",
  "finalUrl",
  "url",
  "status",
  "sourceOk",
  "error",
  "title",
  "markdown",
  "wordCount",
  "truncated",
  "capture",
]);

export function readerFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = {};
  for (const key of READER_FIELD_KEYS) {
    if (Object.hasOwn(body, key)) fields[key] = body[key];
  }
  return fields;
}

export function decodePaymentRequiredHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 131_072) return null;
  for (const encoding of ["base64url", "base64"]) {
    try {
      const decoded = JSON.parse(Buffer.from(raw, encoding).toString("utf8"));
      if (decoded && decoded.x402Version === 2 && Array.isArray(decoded.accepts)) return decoded;
    } catch {
      // Try the other x402 header alphabet.
    }
  }
  return null;
}

export function challengeTerms(decoded) {
  if (!decoded) return null;
  const accept = decoded.accepts.find((entry) => entry?.scheme === "exact") || decoded.accepts[0];
  if (!accept) return null;
  const identifier = decoded.extensions?.["payment-identifier"];
  return {
    x402Version: decoded.x402Version,
    scheme: accept.scheme,
    network: accept.network,
    amount: accept.amount,
    payTo: accept.payTo,
    asset: accept.asset,
    maxTimeoutSeconds: accept.maxTimeoutSeconds,
    extraName: accept.extra?.name ?? null,
    extraVersion: accept.extra?.version ?? null,
    paymentIdentifierRequired: identifier?.info?.required ?? null,
    resourceUrl: typeof decoded.resource?.url === "string" ? decoded.resource.url : null,
    authorizationNonce: accept.nonce ?? accept.extra?.nonce ?? null,
  };
}
