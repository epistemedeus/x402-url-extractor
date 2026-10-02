import { createHash } from "node:crypto";

import { concernKeys, runScan } from "./adapter.mjs";
import { RETEST_SCHEMA, SKILLGUARD } from "./pins.mjs";
import { redactTree } from "./redact.mjs";

function digest(files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function inventoryDigest(files) {
  return digest(files);
}

export async function rerun(previous, request, options) {
  const prep = process.hrtime.bigint();
  if (!previous || previous.schema !== "samedaydesk.scoped-surface.v1" || previous.scanPerformed !== true) {
    return inconclusive("forged_or_absent_prior", null, prep);
  }
  if (previous.scanner?.commit !== SKILLGUARD.commit) {
    return inconclusive("scanner_pin_changed", null, prep);
  }
  if (previous.taskId !== request?.taskId || previous.concern?.id !== request?.concern?.id) {
    return inconclusive("concern_or_task_changed", null, prep);
  }
  const current = await runScan(request, options);
  current.measurement.contributorPrepMicros = Math.round(Number(process.hrtime.bigint() - prep) / 1000);
  if (current.scanPerformed !== true || current.concern.result === "inconclusive" || previous.concern.result === "inconclusive") {
    return body("inconclusive", current.concern?.reason || previous.concern?.reason || "inconclusive", previous, current);
  }
  const before = concernKeys(previous);
  const after = concernKeys(current);
  const same = before.length === after.length && before.every((key, index) => key === after[index]);
  if (same) return body("unchanged", before.length ? "same_findings" : "same_no_match", previous, current);
  if (before.length > 0 && after.length === 0) {
    return body("fixed", current.scannerExit === 0 ? "concern_cleared" : "concern_cleared_other_findings_remain", previous, current);
  }
  return body("inconclusive", "partial_or_new", previous, current);
}

function inconclusive(reason, current, prep) {
  return redactTree({
    schema: RETEST_SCHEMA,
    comparison: "inconclusive",
    reason,
    previousConcernKeys: [],
    currentConcernKeys: [],
    exitCode: 65,
    current,
    measurement: {
      contributorPrepMicros: Math.round(Number(process.hrtime.bigint() - prep) / 1000),
      cash: "unknown",
      tokens: "unknown",
      profit: "unknown",
      recognizedRevenueAtomic: "0",
    },
  });
}

function body(comparison, reason, previous, current) {
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
    measurement: current.measurement,
  });
}
