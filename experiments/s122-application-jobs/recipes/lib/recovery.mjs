export const OUTCOMES = Object.freeze([
  "unchanged",
  "changed",
  "partial",
  "error",
  "stale_baseline",
  "timed_out",
]);

export function classifyStaleCurrent(capturedAt, clock, horizonHours) {
  if (!capturedAt || !clock || horizonHours == null) {
    return { stale: false, reason: "horizon_not_supplied" };
  }
  const capturedMs = Date.parse(capturedAt);
  const clockMs = Date.parse(clock);
  if (!Number.isFinite(capturedMs) || !Number.isFinite(clockMs)) {
    return { stale: false, reason: "unparseable_clock" };
  }
  const ageHours = (clockMs - capturedMs) / 3_600_000;
  if (ageHours > Number(horizonHours)) {
    return {
      stale: true,
      reason: "current_older_than_horizon",
      ageHours,
      horizonHours: Number(horizonHours),
    };
  }
  return { stale: false, ageHours, horizonHours: Number(horizonHours) };
}

export function recoveryPlan(outcome, detail = {}, nextAction = null) {
  const actionHint = nextAction ? ` Next action: ${nextAction}.` : "";
  switch (outcome) {
    case "unchanged":
      return {
        action: "keep_prior",
        operatorNext: `No justified content or deadline change against the immutable prior. Keep the prior; schedule the next operator-supplied run.${actionHint}`,
        detail,
      };
    case "changed":
      return {
        action: "review_and_sequence",
        operatorNext: `Review the evidence, then write a new sequenced artifact. Do not overwrite the immutable prior.${actionHint}`,
        detail,
      };
    case "partial":
      return {
        action: "keep_partial_rows",
        operatorNext:
          "Keep successful fields visible. Retry only the missing fields with a fresh operator run. Partial does not justify a next-action claim.",
        detail,
      };
    case "stale_baseline":
      return {
        action: "refresh_baseline",
        operatorNext:
          "The current observation is older than the operator horizon. Capture a fresh current snapshot before deciding. Keep the immutable prior.",
        detail,
      };
    case "timed_out":
      return {
        action: "bounded_retry_then_stop",
        operatorNext:
          "The observation step timed out. Keep the immutable prior and any partial evidence. Retry only on a fresh operator run. Do not replay payment.",
        detail,
      };
    case "error":
    default:
      return {
        action: "bounded_retry_then_stop",
        operatorNext:
          "Apply the recipe's bounded retry policy, then stop with the error evidence. Do not invent success or replay payment.",
        detail,
      };
  }
}
