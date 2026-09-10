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
  if (raw == null || raw === "") {
    return schemaRejected ? "invalid" : "unknown";
  }
  const s = String(raw).toLowerCase().replace(/-/g, "_");
  let mapped = "unknown";
  if (["pass", "ready", "ok", "matched", "agree", "aligned", "complete"].includes(s)) mapped = "pass";
  else if (["partial", "partial_input", "partialinput"].includes(s)) mapped = "partial";
  else if (["conflict", "conflicted", "disagree", "mismatch"].includes(s)) mapped = "conflict";
  else if (["fail", "failed", "reject", "rejected", "negative"].includes(s)) mapped = "fail";
  else if (["invalid", "invalid_input", "malformed", "schema_rejected"].includes(s)) mapped = "invalid";
  else if (["unsupported", "unavailable", "unavailable_pending_heavy", "missing_dependency", "out_of_scope"].includes(s)) {
    mapped = "unsupported";
  } else if (["unknown", "empty"].includes(s)) mapped = "unknown";
  // Schema rejection must never promote a false pass (S174). Preserve
  // conflict/partial/fail/invalid as the business outcome.
  if (schemaRejected && (mapped === "pass" || mapped === "unknown")) return "invalid";
  return mapped;
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
    artifact: fields.artifact ?? null,
    schemaRejected: Boolean(fields.schemaRejected),
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
