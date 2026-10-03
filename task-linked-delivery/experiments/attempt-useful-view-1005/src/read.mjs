import { REPORT_SCHEMA, EVENT_ID, ATTEMPT_OF } from "./constants.mjs";
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

export async function readPersistedAttempt({ dataDir, taskRef, baseline = null, link = null, restart = null, internalToken = "", cut: suppliedCut = null, cutId = null, commerceEventId = null } = {}) {
  if (link?.paymentReplay === true) {
    const error = new Error("payment_replay_refused");
    error.code = "payment_replay_refused";
    throw error;
  }
  const cut = suppliedCut || await readBoundedCut(dataDir, { internalToken, cutId });
  if (commerceEventId && !EVENT_ID.test(commerceEventId)) throw Object.assign(new Error("counterfeit_link"), { code: "counterfeit_link" });
  const eventIds = [...new Set((cut.task_refs || []).filter(row => row.taskRef === taskRef).map(row => row.commerceEventId))].sort((a, b) => {
    const at = id => Date.parse(cut.attempts.find(row => row.id === id)?.ts) || 0;
    return at(a) - at(b) || a.localeCompare(b);
  });
  if (!commerceEventId && !link && eventIds.length > 1) {
    if (eventIds.length > 20) throw Object.assign(new Error("task_attempt_limit_exceeded"), { code: "task_attempt_limit_exceeded" });
    const attempts = [];
    for (const eventId of eventIds) attempts.push(await readPersistedAttempt({ dataDir, taskRef, baseline, restart, internalToken, cut, commerceEventId: eventId }));
    return { schema: REPORT_SCHEMA, decision: "task_attempts", taskRef, attempts, cutId: cut.cutId, window: cut.window, capture: cut.capture,
      planeCoverage: cut.planes, journalCutCoverage: cut.coverage, stageCounts: null, populationConversionRate: null,
      customer: null, outsideUseEstablished: false, paymentPermitted: false, recognizedRevenueAtomic: "unknown", automaticMutationRetries: 0 };
  }
  let journal = null;
  let exportError = null;
  try {
    journal = bundleForTask(cut, taskRef, commerceEventId || link?.commerceEventId || null);
  } catch (error) {
    if (error?.code === "counterfeit_link") throw error;
    exportError = error?.code || "export_rejected";
  }
  if (!journal) {
    return {
      schema: REPORT_SCHEMA,
      decision: "unresolved",
      reason: exportError || "journal_not_covered",
      attemptOf: ATTEMPT_OF,
      taskRef,
      cutId: cut.cutId || null,
      window: cut.window,
      capture: cut.capture,
      planeCoverage: cut.planes,
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
      recognizedRevenueAtomic: "unknown",
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
  return { ...report, stageWords: stageWords(report), cutId: cut.cutId, capture: cut.capture, planeCoverage: cut.planes, window: cut.window };
}
