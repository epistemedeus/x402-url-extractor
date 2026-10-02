import { concernKeys, runScan } from "./adapter.mjs";
import { budgetFromLimits } from "./budget.mjs";
import { PUBLIC_LIMITS, RETEST_SCHEMA, SCHEMA } from "./pins.mjs";
import { redactTree } from "./redact.mjs";

// A saved report is an observation. Repair history comes from scanning the
// original bytes again, or from a server-owned prior that holds those bytes.
export function isUnverifiedPrior(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.schema === SCHEMA || value.schema === RETEST_SCHEMA) return true;
  if (value.scanPerformed === true) return true;
  if (Array.isArray(value.findings)) return true;
  if (value.scanner && value.concern?.result && !Array.isArray(value.files)) return true;
  return false;
}

export async function rerun(spec, options = {}) {
  const prep = process.hrtime.bigint();
  const original = spec?.original;
  const request = spec?.request;
  const budget = options.budget || budgetFromLimits(request?.limits || original?.limits);
  if (spec?.previous || isUnverifiedPrior(original) || isUnverifiedPrior(spec)) {
    return inconclusive("unverified_prior", null, prep, budget, 66);
  }
  let originalRequest = original;
  if (spec?.prior) {
    if (!options.journal || typeof options.journal.takePrior !== "function") {
      return inconclusive("prior_unavailable", null, prep, budget, 65);
    }
    originalRequest = options.journal.takePrior(spec.prior);
    if (!originalRequest) return inconclusive("unverified_prior", null, prep, budget, 66);
  }
  if (!originalRequest || !request) return inconclusive("forged_or_absent_prior", null, prep, budget, 66);
  const previous = await runScan(originalRequest, { ...options, budget });
  if (previous.scanPerformed !== true) {
    return inconclusive(previous.concern?.reason || "original_not_scanned", previous, prep, budget, previous.exitCode || 65);
  }
  if (previous.taskId !== request.taskId || previous.concern?.id !== request?.concern?.id) {
    return inconclusive("concern_or_task_changed", previous, prep, budget, 65);
  }
  const current = await runScan(request, { ...options, budget });
  if (current.measurement) {
    current.measurement.contributorPrepMicros = Math.round(Number(process.hrtime.bigint() - prep) / 1000);
  }
  if (current.scanPerformed !== true || current.concern.result === "inconclusive" || previous.concern.result === "inconclusive") {
    return body("inconclusive", current.concern?.reason || previous.concern?.reason || "inconclusive", previous, current, budget);
  }
  const before = concernKeys(previous);
  const after = concernKeys(current);
  const same = before.length === after.length && before.every((key, index) => key === after[index]);
  if (same) return body("unchanged", before.length ? "same_findings" : "same_no_match", previous, current, budget);
  if (before.length > 0 && after.length === 0) {
    return body("fixed", current.scannerExit === 0 ? "concern_cleared" : "concern_cleared_other_findings_remain", previous, current, budget);
  }
  return body("inconclusive", "partial_or_new", previous, current, budget);
}

function inconclusive(reason, current, prep, budget, exitCode) {
  return redactTree({
    schema: RETEST_SCHEMA,
    comparison: "inconclusive",
    reason,
    previousConcernKeys: [],
    currentConcernKeys: [],
    exitCode,
    current,
    universalGuarantee: false,
    blanketSafetyScore: null,
    unverifiedPrior: reason === "unverified_prior",
    limits: PUBLIC_LIMITS,
    operation: budget?.snapshot?.() || null,
    measurement: {
      contributorPrepMicros: Math.round(Number(process.hrtime.bigint() - prep) / 1000),
      cash: "unknown",
      tokens: "unknown",
      profit: "unknown",
      recognizedRevenueAtomic: "0",
    },
  });
}

function body(comparison, reason, previous, current, budget) {
  return redactTree({
    schema: RETEST_SCHEMA,
    comparison,
    reason,
    previousConcernKeys: concernKeys(previous),
    currentConcernKeys: concernKeys(current),
    exitCode: current.exitCode,
    otherFindingsRemain: current.scannerExit !== 0 && comparison === "fixed",
    universalGuarantee: false,
    blanketSafetyScore: null,
    current,
    operation: budget?.snapshot?.() || null,
    measurement: current.measurement,
  });
}
