/**
 * Shared result contract for S178 consumer-repeat package (jobs 01–08).
 * ok = transport/execution honesty; decision = business outcome.
 * Never map fail/conflict/invalid to pass.
 */
export const RESULT_SCHEMA = "s178.consumer-repeat.result.v1";
export const CATALOG_SCHEMA = "s178.consumer-repeat.catalog.v1";
export const REPEAT_INPUT_SCHEMA = "s178.consumer-repeat.repeat-input.v1";

export const DECISIONS = Object.freeze([
  "pass",
  "partial",
  "conflict",
  "fail",
  "invalid",
  "unsupported",
  "unknown",
]);

export function normalizeDecision(raw, { schemaRejected = false } = {}) {
  if (schemaRejected) return "invalid";
  if (raw == null || raw === "") return "unknown";
  const s = String(raw).toLowerCase().replace(/-/g, "_");
  if (["pass", "ready", "ok", "matched", "agree", "aligned", "complete"].includes(s)) return "pass";
  if (["partial", "partial_input", "partialinput"].includes(s)) return "partial";
  if (["conflict", "conflicted", "disagree", "mismatch"].includes(s)) return "conflict";
  if (["fail", "failed", "reject", "rejected", "negative"].includes(s)) return "fail";
  if (["invalid", "invalid_input", "malformed", "schema_rejected"].includes(s)) return "invalid";
  if (["unsupported", "unavailable", "unavailable_pending_heavy", "missing_dependency", "out_of_scope"].includes(s)) {
    return "unsupported";
  }
  if (["unknown", "empty"].includes(s)) return "unknown";
  return "unknown";
}

export function createResult(fields = {}) {
  const decision = normalizeDecision(fields.decision, {
    schemaRejected: Boolean(fields.schemaRejected),
  });
  return {
    schema: RESULT_SCHEMA,
    jobId: fields.jobId ?? null,
    artifactId: fields.artifactId ?? null,
    clock: fields.clock ?? null,
    mode: fields.mode ?? null,
    offline: true,
    payment: { attempted: false },
    ok: fields.ok !== false,
    decision,
    sources: Array.isArray(fields.sources) ? fields.sources : [],
    findings: Array.isArray(fields.findings) ? fields.findings : [],
    limitations: Array.isArray(fields.limitations) ? fields.limitations : [],
    freshness: fields.freshness ?? null,
    repeatInput: fields.repeatInput ?? null,
    native: fields.native ?? null,
    error: fields.error ?? null,
    claims: {
      inventsFacts: false,
      paidEndpoint: false,
      legalAttestation: false,
      modelAsOracle: false,
      assertsCustomerDemand: false,
      greenwashesFailure: false,
    },
  };
}

export function createRepeatInput(fields = {}) {
  return {
    schema: REPEAT_INPUT_SCHEMA,
    jobId: fields.jobId ?? null,
    artifactId: fields.artifactId ?? null,
    priorDecision: fields.priorDecision ?? null,
    reason: fields.reason ?? "additional_input_required",
    missing: Array.isArray(fields.missing) ? fields.missing : [],
    suggestedPaths: Array.isArray(fields.suggestedPaths) ? fields.suggestedPaths : [],
    nextActions: Array.isArray(fields.nextActions) ? fields.nextActions : [],
    offline: true,
    payment: { attempted: false },
  };
}
