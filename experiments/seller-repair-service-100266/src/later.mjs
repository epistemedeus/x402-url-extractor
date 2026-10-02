export function laterApplicability({ intake, taskDigest, sdk, retest }) {
  if (taskDigest !== intake.taskDigest || sdk !== intake.declaredSdk) {
    return {
      reused: false,
      reason: "stale_applicability",
      usefulTransferred: false,
      repairApplied: false,
      paymentPermitted: false,
      currentTask: taskDigest === intake.taskDigest,
      currentSdk: sdk === intake.declaredSdk,
    };
  }
  return {
    reused: retest?.useful === true,
    reason: retest?.useful === true ? "current_task_retest" : "current_task_not_useful",
    usefulTransferred: false,
    repairApplied: retest?.useful === true,
    paymentPermitted: false,
    currentTask: true,
    currentSdk: true,
  };
}
