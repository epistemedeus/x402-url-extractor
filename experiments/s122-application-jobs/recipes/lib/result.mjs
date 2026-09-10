import { costForRecipe } from "./cost.mjs";
import { recoveryPlan } from "./recovery.mjs";

export const RESULT_SCHEMA = "s122.application-job-result.v1";

export function finishResult(partial) {
  const recovery = recoveryPlan(partial.outcome, partial.evidence, partial.nextAction ?? null);
  return {
    ...partial,
    ok: partial.outcome === "unchanged" || partial.outcome === "changed" || partial.outcome === "partial",
    schema: RESULT_SCHEMA,
    execute: false,
    posted: false,
    payment: partial.payment || { attempted: false, replayBlocked: true },
    cost: partial.cost || costForRecipe(partial.recipeId),
    recovery,
    nextAction: Object.prototype.hasOwnProperty.call(partial, "nextAction") ? partial.nextAction : null,
  };
}

export function failResult({ recipeId, meta, code, message, clock, scheduleHint, extra = {} }) {
  return finishResult({
    recipeId,
    meta,
    outcome: extra.outcome || "error",
    clock,
    scheduleHint,
    nextAction: null,
    evidence: { kind: "error", code, message },
    ...extra,
  });
}
