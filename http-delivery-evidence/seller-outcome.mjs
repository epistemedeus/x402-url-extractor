import { RESOURCES, SELLER_INTEGRITY_CONTRACT, MAX_RESPONSE_BYTES } from "./contract.mjs";
import { VALIDATOR_AUTHORITY, VALIDATOR_SOURCE } from "./classify.mjs";

export const SELLER_OUTCOME_SCHEMA = "samedaydesk.seller-audit-outcome.v1";
export const MAX_OUTCOME_BYTES = 1024;
const DECISIONS = ["machine_buyable", "contract_ready", "repair_required"];
const FAILURES = ["exact_route_not_declared", "openapi_unavailable", "openapi_invalid", "route_ceiling_exceeded", "bounded_transport_failure"];
const COVERAGE = ["verified", "static_post", "target_unconstructible", "probe_failed", "challenge_unverified", "incomplete", "unknown"];
const CONTRACTS = ["admissible", "absent", "partial", "invalid", "unknown"];
const COUNTS = ["contractAbsent", "contractPartial", "contractInvalid", "requiredPathMissing", "targetInvalid", "bindingMismatch", "economicsMismatch", "protocolInvalid", "bazaarInvalid", "probeFailed", "unknownFindings"];
const KEYS = ["schemaVersion", "responseDigest", "decision", "auditCompleted", "failureCategory", "runtimeCoverage", "contractCoverage", "repairMode", "repairComplete", ...COUNTS, "findingOverflow"].sort();
const EXACT_CODES = {
  seller_response_contract_absent: "contractAbsent",
  seller_response_contract_partial: "contractPartial",
  seller_response_contract_invalid: "contractInvalid",
  x402_full_request_binding_mismatch: "bindingMismatch",
  x402_mpp_economics_mismatch: "economicsMismatch",
  mpp_declaration_runtime_mismatch: "economicsMismatch",
  x402_declaration_runtime_mismatch: "economicsMismatch",
  x402_payment_required_schema_invalid: "protocolInvalid",
  x402_resource_schema_invalid: "protocolInvalid",
  x402_challenge_invalid: "protocolInvalid",
  mpp_challenge_invalid: "protocolInvalid",
  mpp_realm_mismatch: "protocolInvalid",
  credential_free_probe_failed: "probeFailed",
};
const BAZAAR_CODES = new Set([
  "bazaar_extension_missing", "bazaar_schema_invalid", "bazaar_spec_invalid",
  "bazaar_input_example_or_schema_missing", "bazaar_output_example_or_schema_missing",
  "bazaar_output_schema_unconstrained", "bazaar_input_schema_compile_failed", "bazaar_output_schema_compile_failed",
]);
const result = (status, summary = null) => ({ outcomeSummaryStatus: status, outcomeSummary: summary });
const ownCode = (code) => Object.hasOwn(EXACT_CODES, code) ? EXACT_CODES[code] : null;

function findingCategory(code) {
  if (ownCode(code)) return ownCode(code);
  if (BAZAAR_CODES.has(code) || /^bazaar_(input|output)_example_invalid:/.test(code)) return "bazaarInvalid";
  if (code.startsWith("seller_response_required_path_missing:")) return "requiredPathMissing";
  if (code.startsWith("target_invalid:")) return "targetInvalid";
  return "unknownFindings";
}

function runtimeCoverage(body) {
  const r = body.report;
  if (!r.auditCompleted) return "incomplete";
  if (r.runtimeChallengeVerified) {
    return r.probe?.attempted === true && r.probe.reason === null && r.status === 402 ? "verified" : null;
  }
  if (r.status === 402) return null;
  if (r.probe?.attempted === false && r.probe.reason === "post_requires_explicit_non_secret_fixture") {
    return body.request.method === "POST" && r.status === null ? "static_post" : null;
  }
  if (r.probe?.attempted === false && r.probe.reason === "target_not_constructible") return "target_unconstructible";
  if (r.probe?.attempted === true && r.probe.reason === "request_failed") return "probe_failed";
  if (r.probe?.attempted === true && r.probe.reason === null) return "challenge_unverified";
  return "unknown";
}

/** Only the parsed value of the same complete, schema-checked HTTP bytes enters here. */
export function deriveSellerOutcome(evaluated, record) {
  if (record.resource !== RESOURCES.SELLER_INTEGRITY) return {};
  if (!eligibleRecord(record) || !evaluated.parsed?.ok || evaluated.contract?.ok !== true) return result("unavailable");
  const body = evaluated.parsed.value;
  const r = body.report;
  if (body.version !== "1.3.0" || (r.auditCompleted && r.schemaVersion !== "agent-payment-integrity.audit.v4")) return result("unsupported");
  const coverage = runtimeCoverage(body);
  const completed = r.auditCompleted;
  if (!coverage || body.ok !== (body.decision !== "repair_required")
    || r.valid !== body.ok
    || (completed && r.failureCode !== null)
    || (!completed && (body.decision !== "repair_required" || r.failureCode === null || r.runtimeChallengeVerified || r.probe !== null || r.repairPlan !== null))
    || (body.ok && r.findings.length !== 0)
    || (completed && !body.ok && r.findings.length === 0)) return result("invalid");
  const summary = {
    schemaVersion: SELLER_OUTCOME_SCHEMA,
    responseDigest: record.responseDigest,
    decision: body.decision,
    auditCompleted: completed,
    failureCategory: completed ? "none" : FAILURES.includes(r.failureCode) ? r.failureCode : "unknown",
    runtimeCoverage: coverage,
    contractCoverage: CONTRACTS.includes(r.responseContract?.decision) ? r.responseContract.decision : "unknown",
    repairMode: r.repairPlan === null ? "absent" : "advisory",
    repairComplete: r.repairPlan?.complete ?? null,
    ...Object.fromEntries(COUNTS.map((key) => [key, 0])),
    findingOverflow: false,
  };
  for (const code of r.findings) {
    const key = findingCategory(code);
    if (summary[key] === 99) summary.findingOverflow = true;
    else summary[key] += 1;
  }
  return canonicalSellerOutcome({ ...record, ...result("available", summary) });
}

function eligibleRecord(r) {
  return r.resource === RESOURCES.SELLER_INTEGRITY
    && ["GET", "POST"].includes(r.method)
    && r.contractName === SELLER_INTEGRITY_CONTRACT
    && r.validatorAuthority === VALIDATOR_AUTHORITY && r.validatorSource === VALIDATOR_SOURCE
    && r.merchantHttpStatus >= 200 && r.merchantHttpStatus < 300
    && r.retainedByteLength > 0 && r.retainedByteLength === r.responseByteLength
    && r.responseByteLength <= MAX_RESPONSE_BYTES
    && r.counters?.schemaErrors === 0 && r.counters?.truncateMarks === 0 && r.counters?.sourceRefusalMarks === 0
    && ((r.validatorVerdict === "pass" && r.deliveryClass === "full_bounded_capture")
      || (r.validatorVerdict === "unknown" && r.deliveryClass === "incomplete_report"));
}

/** Disk is a version boundary. Reject only semantic metadata; preserve delivery evidence. */
export function canonicalSellerOutcome(record) {
  if (!Object.hasOwn(record, "outcomeSummary") && !Object.hasOwn(record, "outcomeSummaryStatus")) return {};
  const s = record.outcomeSummary;
  if (["unavailable", "invalid", "unsupported"].includes(record.outcomeSummaryStatus) && s === null) return result(record.outcomeSummaryStatus);
  if (!s || typeof s !== "object" || Array.isArray(s)) return result("invalid");
  if (typeof s.schemaVersion === "string" && s.schemaVersion !== SELLER_OUTCOME_SCHEMA) return result("unsupported");
  if (record.outcomeSummaryStatus !== "available" || !eligibleRecord(record)) return result("invalid");
  const keys = Object.keys(s).sort();
  if (keys.length !== KEYS.length || keys.some((key, i) => key !== KEYS[i])) return result("invalid");
  if (s.schemaVersion !== SELLER_OUTCOME_SCHEMA || s.responseDigest !== record.responseDigest
    || !/^[0-9a-f]{64}$/.test(s.responseDigest) || !DECISIONS.includes(s.decision)
    || typeof s.auditCompleted !== "boolean" || !["none", "unknown", ...FAILURES].includes(s.failureCategory)
    || !COVERAGE.includes(s.runtimeCoverage) || !CONTRACTS.includes(s.contractCoverage)
    || !["advisory", "absent"].includes(s.repairMode) || ![true, false, null].includes(s.repairComplete)
    || typeof s.findingOverflow !== "boolean"
    || COUNTS.some((key) => !Number.isInteger(s[key]) || s[key] < 0 || s[key] > 99)) return result("invalid");
  const findings = COUNTS.reduce((n, key) => n + s[key], 0);
  if ((s.findingOverflow && !COUNTS.some((key) => s[key] === 99))
    || ((s.repairMode === "absent") !== (s.repairComplete === null))
    || (s.auditCompleted !== (record.validatorVerdict === "pass"))
    || (s.auditCompleted && (s.failureCategory !== "none" || s.runtimeCoverage === "incomplete"))
    || (!s.auditCompleted && (s.failureCategory === "none" || s.decision !== "repair_required" || s.runtimeCoverage !== "incomplete" || s.repairMode !== "absent" || s.contractCoverage !== "unknown"))
    || (s.auditCompleted && s.decision === "repair_required" && findings === 0)
    || (s.decision !== "repair_required" && (findings !== 0 || s.findingOverflow || !s.auditCompleted || s.contractCoverage !== "admissible"))
    || (s.decision === "machine_buyable" && s.runtimeCoverage !== "verified")
    || (s.decision === "contract_ready" && s.runtimeCoverage !== "static_post")) return result("invalid");
  // Rebuild in fixed order; no arbitrary keys, arrays, objects, or strings survive.
  const copy = Object.fromEntries(KEYS.map((key) => [key, s[key]]));
  if (Buffer.byteLength(JSON.stringify(copy)) > MAX_OUTCOME_BYTES) return result("invalid");
  return result("available", copy);
}

export function sellerOutcomeForJoin(records, disposition) {
  if (records.length === 0) return result("missing");
  if (disposition !== "exact_join" && disposition !== "incomplete_capture") return result("unavailable");
  const fields = records.map(canonicalSellerOutcome);
  if (fields.some((f) => f.outcomeSummaryStatus === "invalid")) return result("invalid");
  if (fields.some((f) => f.outcomeSummaryStatus === "unsupported")) return result("unsupported");
  if (fields.some((f) => !f.outcomeSummaryStatus)) return result("missing");
  if (fields.some((f) => f.outcomeSummaryStatus !== "available")) return result("unavailable");
  const first = JSON.stringify(fields[0]);
  if (fields.some((f) => JSON.stringify(f) !== first)) return result("invalid");
  return fields[0];
}

/** Structural check for a digest-free operator export; it grants no evidence authority. */
export function isPublicSellerOutcome(summary, validatorVerdict, deliveryClass) {
  if (!summary || Object.hasOwn(summary, "responseDigest")) return false;
  const digest = "0".repeat(64);
  return canonicalSellerOutcome({
    method: "GET", resource: RESOURCES.SELLER_INTEGRITY, contractName: SELLER_INTEGRITY_CONTRACT,
    validatorAuthority: VALIDATOR_AUTHORITY, validatorSource: VALIDATOR_SOURCE, validatorVerdict, deliveryClass,
    merchantHttpStatus: 200, retainedByteLength: 1, responseByteLength: 1,
    responseDigest: digest, counters: { schemaErrors: 0, truncateMarks: 0, sourceRefusalMarks: 0 },
    outcomeSummaryStatus: "available", outcomeSummary: { ...summary, responseDigest: digest },
  }).outcomeSummaryStatus === "available";
}
