/**
 * Kill-harness comparison: changelog baseline A vs usage binder.
 *
 * Binder nextAction may be packet-coarse (action|unknown|no_action) or the
 * c06 detail words (review_breakages|upgrade_with_edits). Both collapse here.
 */

export const PACKET_DECISIONS = Object.freeze(["action", "unknown", "no_action"]);

const BINDER_TO_PACKET = Object.freeze({
  action: "action",
  review_breakages: "action",
  upgrade_with_edits: "action",
  unknown: "unknown",
  no_action: "no_action",
});

export function coarseBinderDecision(bindResult) {
  if (typeof bindResult === "string") return mapWord(bindResult);
  if (!bindResult || typeof bindResult !== "object") return "unknown";
  const next =
    (bindResult.summary && bindResult.summary.nextAction) ||
    bindResult.nextAction ||
    bindResult.decision ||
    "";
  return mapWord(next);
}

export function coarseStubDecision(stubResult) {
  if (typeof stubResult === "string") return mapWord(stubResult);
  if (!stubResult || typeof stubResult !== "object") return "unknown";
  return mapWord(stubResult.decision || stubResult.summary?.nextAction || "");
}

/**
 * True when binder's coarse packet decision differs from the changelog stub.
 * That difference is the S127 hypothesis; absence of difference on real A/B
 * is the kill condition.
 */
export function decisionChangedRelativeToChangelog(stubResult, bindResult) {
  return coarseStubDecision(stubResult) !== coarseBinderDecision(bindResult);
}

export function compareBaselineToBinder(stubResult, bindResult) {
  const changelogDecision = coarseStubDecision(stubResult);
  const binderDecision = coarseBinderDecision(bindResult);
  return {
    schema: "s127.upgrade-impact.kill-compare.v1",
    baseline: "A",
    changelogDecision,
    binderDecision,
    decisionChangedRelativeToChangelog: changelogDecision !== binderDecision,
    stubUsageBinding: false,
    note:
      changelogDecision === binderDecision
        ? "binding did not change the coarse decision relative to changelog/registry skim"
        : "binding changed the coarse decision relative to changelog/registry skim",
  };
}

function mapWord(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return BINDER_TO_PACKET[key] || "unknown";
}
