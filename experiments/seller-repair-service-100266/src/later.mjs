function sameTarget(intake, target) {
  if (!target) return false;
  return target.origin === intake.origin && target.method === intake.method && target.resource === intake.resource;
}

export function laterApplicability({ intake, taskDigest, sdk, target = null, callerId = null, retest, independentRetest = false }) {
  const boundTarget = target || { origin: intake.origin, method: intake.method, resource: intake.resource };
  const currentTask = taskDigest === intake.taskDigest;
  const currentSdk = sdk === intake.declaredSdk;
  const currentTarget = sameTarget(intake, boundTarget);
  const laterCaller = typeof callerId === "string" && callerId !== intake.callerId;
  if (!currentTask || !currentSdk || !currentTarget) {
    return {
      reused: false,
      reason: "stale_applicability",
      usefulTransferred: false,
      repairApplied: false,
      paymentPermitted: false,
      currentTask,
      currentSdk,
      currentTarget,
      laterCaller,
      sameInputQa: false,
      independentRetest: false,
      trustedPriorUseful: false,
    };
  }
  const useful = independentRetest === true && retest?.useful === true;
  return {
    reused: useful,
    reason: useful
      ? (laterCaller ? "later_caller_retest" : "current_task_retest")
      : independentRetest ? "current_task_not_useful" : "prior_result_not_retested",
    usefulTransferred: false,
    repairApplied: useful,
    paymentPermitted: false,
    currentTask: true,
    currentSdk: true,
    currentTarget: true,
    laterCaller,
    sameInputQa: !laterCaller && independentRetest === true,
    independentRetest: independentRetest === true,
    trustedPriorUseful: false,
  };
}
