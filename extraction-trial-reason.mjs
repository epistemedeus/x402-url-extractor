// Trial-local diagnostic vocabulary. Never copy source strings or response data
// into the journal. Both the observer and restored-row projection validate here.
const HTTP_CODES = new Set(["http_1xx", "http_3xx", "http_4xx", "http_403", "http_429", "http_5xx"]);
const FETCH_CODES = new Set(["timeout", "ssrf_blocked", "redirect_error", "unsupported_encoding", "invalid_response"]);
const AVAILABILITY_CODES = new Set(["disabled", "scheduled", "expired", "exhausted", "busy", "unavailable"]);
const REFUSAL_CODES = new Set([
  "method_not_allowed", "invalid_trial_body", "invalid_trial_input",
  "disabled", "scheduled", "expired", "exhausted", "busy", "unavailable",
]);

// Optional operation is supplied by the mount, never inferred from callers or
// historical route rows (whose canonical aggregate route remains unchanged).
export function normalizeExtractionTrialOperation(value) {
  return value === "extract" || value === "read" ? value : null;
}

// Protocol label only. Anything else is omitted so a caller string cannot enter the journal.
export function normalizeExtractionTrialTransport(value) {
  return value === "http" || value === "mcp" ? value : null;
}

export function normalizeExtractionTrialReason(outcome, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "code,family,v" || value.v !== 1) return null;
  const { family, code } = value;
  const accepted = outcome === "failed"
    ? (family === "source_http" && HTTP_CODES.has(code)) || (family === "fetch" && FETCH_CODES.has(code))
    : outcome === "refused" && family === "admission" && REFUSAL_CODES.has(code);
  return accepted ? { v: 1, family, code } : null;
}

export function trialSourceHttpReason(data) {
  const status = data?.status;
  if (data?.ok !== true || data.sourceOk !== false || !Number.isInteger(status)
    || status < 100 || status > 599 || (status >= 200 && status < 300)
    || data.error?.code !== `http_${status}`) return null;
  const code = status === 403 || status === 429 ? `http_${status}` : `http_${Math.floor(status / 100)}xx`;
  return normalizeExtractionTrialReason("failed", { v: 1, family: "source_http", code });
}

export function trialFetchFailureReason(code) {
  return normalizeExtractionTrialReason("failed", { v: 1, family: "fetch", code });
}

export function trialRefusalReason(error, availability) {
  if (error === "trial_unavailable" && !AVAILABILITY_CODES.has(availability)) return null;
  const code = error === "trial_unavailable" ? availability : error;
  return normalizeExtractionTrialReason("refused", { v: 1, family: "admission", code });
}
