import { ATTEMPT_OF } from "./constants.mjs";
import { bundleForTask, readBoundedCut } from "./cut.mjs";
import { readAttemptUsefulView } from "./view.mjs";

export function stageWords(report) {
  const words = {};
  for (const [name, stage] of Object.entries(report?.stages || {})) {
    const word = stage?.disposition === "unresolved" ? "unknown" : stage?.disposition;
    if (typeof word === "number" || word === 0) {
      const error = new Error("stage_count_refused");
      error.code = "stage_count_refused";
      throw error;
    }
    words[name] = word ?? "unknown";
  }
  return words;
}

export async function readPersistedAttempt({ dataDir, taskRef, baseline = null, link = null, restart = null } = {}) {
  if (link?.paymentReplay === true) {
    const error = new Error("payment_replay_refused");
    error.code = "payment_replay_refused";
    throw error;
  }
  const cut = await readBoundedCut(dataDir);
  let journal = null;
  let exportError = null;
  try {
    journal = bundleForTask(cut, taskRef);
  } catch (error) {
    exportError = error?.code || "export_rejected";
  }
  if (!journal) {
    return {
      decision: "unresolved",
      reason: exportError || "journal_not_covered",
      attemptOf: ATTEMPT_OF,
      taskRef,
      liveCoverage: "unresolved",
      liveCoverageReason: "unresolved",
      journalCutCoverage: cut.coverage === "complete" || cut.coverage === "partial" || cut.coverage === "unknown"
        ? cut.coverage
        : "unknown",
      useful: null,
      stageCounts: null,
      stages: {
        attempt: { disposition: "unresolved", reason: exportError || "journal_not_covered", observed: "unknown" },
        delivery: { disposition: "unresolved", reason: exportError || "journal_not_covered", observed: "unknown" },
        callerUsefulness: { disposition: "unresolved", reason: exportError || "journal_not_covered", observed: "unknown" },
        independentReplay: { disposition: "unresolved", reason: exportError || "journal_not_covered", observed: "unknown" },
        retention: { disposition: "unresolved", reason: exportError || "journal_not_covered", observed: "unknown" },
        laterUse: { disposition: "unresolved", reason: exportError || "journal_not_covered", observed: "unknown" },
        settlement: { disposition: "unresolved", reason: exportError || "journal_not_covered", observed: "unknown" },
      },
      paymentPermitted: false,
      recognizedRevenueAtomic: "0",
      mintedGrant: false,
      automaticMutationRetries: 0,
    };
  }
  const report = readAttemptUsefulView({
    attemptOf: ATTEMPT_OF,
    taskRef,
    journal,
    baseline,
    ...(link ? { link } : {}),
    ...(restart ? { restart } : {}),
  });
  return { ...report, stageWords: stageWords(report) };
}
