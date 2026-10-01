import { PAID_OPERATION_PATH } from "./constants.mjs";

function rate(numerator, denominator) {
  if (denominator === 0) return null;
  return numerator / denominator;
}

function experiment(id, eligible, converted, reason, extra = {}) {
  return {
    id,
    eligibleCount: eligible,
    conversionCount: denominatorReady(eligible) ? converted : null,
    conversionRate: rate(converted, eligible),
    countedBeforeEligibility: false,
    reason,
    ...extra,
  };
}

function denominatorReady(eligible) {
  return eligible > 0;
}

export function eligibilityReport({ tasks, citedSample, downloads }) {
  const installTasks = tasks.filter((task) => task.experimentId === "native-install-unpaid-call" && task.decisionCurrent);
  const installEligible = installTasks.filter((task) => task.nativeInstall).length;
  const installConverted = installTasks.filter((task) => (
    task.nativeInstall
    && task.unpaidUseful
    && task.stages.valid_call > 0
    && task.stages.useful_result > 0
    && task.stages.later_useful_call > 0
  )).length;

  const doors = Array.isArray(citedSample?.doors) ? citedSample.doors : [];
  const freeSufficientDoors = doors.filter((door) => door.freeSufficient === true).length;
  const paidTasks = tasks.filter((task) => task.experimentId === "free-diagnosis-paid-operation" && task.decisionCurrent);
  const paidEligibleTasks = paidTasks.filter((task) => (
    task.freeSufficient === false
    && task.incrementalValue === true
    && task.paidOperation
  ));
  const paidConverted = paidEligibleTasks.filter((task) => (
    task.stages.explicit_purchase_attempt > 0
    && task.stages.settlement > 0
    && task.stages.useful_result > 0
    && task.stages.later_useful_call > 0
    && task.useful === "true"
  )).length;
  const ineligiblePaidWithStages = paidTasks.filter((task) => (
    task.freeSufficient !== false
    && task.stages.settlement > 0
  )).length;

  const bountyTasks = tasks.filter((task) => task.experimentId === "bounty-contract-reused-artifact" && task.decisionCurrent);
  const bountyEligible = bountyTasks.filter((task) => (
    task.rewardPresent === true && task.contractCurrent === true && task.artifactVerified
  )).length;
  const bountyConverted = bountyTasks.filter((task) => (
    task.rewardPresent === true
    && task.contractCurrent === true
    && task.artifactVerified
    && task.stages.later_useful_call > 0
    && task.useful === "true"
  )).length;

  return {
    nativeInstallUnpaidCall: experiment(
      "native-install-unpaid-call",
      installEligible,
      installConverted,
      installEligible === 0 ? "no_eligible_denominator" : (installConverted === installEligible ? "eligible_tasks_converted" : "eligible_without_full_conversion"),
      {
        job: "INSTALL-TO-FIRST-CALL-100166",
        eligibility: "Official runtime recorded, SKILL.md present, linked support files present, header not spoofed. CLI exit 0 alone is not eligible.",
        conversion: "Eligible install, then one unpaid valid call whose receipt is explicitly readable, then a later process reads that receipt.",
        doesNotCount: ["cli_exit_0", "http_200_download", "http_402", "user_agent_label", "settlement_reference"],
      },
    ),
    freeDiagnosisPaidOperation: experiment(
      "free-diagnosis-paid-operation",
      paidEligibleTasks.length,
      paidConverted,
      paidEligibleTasks.length === 0 ? "sample_negative_no_eligible_denominator" : "eligible_paid_operation_only",
      {
        operationPath: PAID_OPERATION_PATH,
        eligibility: "Free diagnosis does not already decide the task, and the existing seller-integrity audit is the paid operation. A free-sufficient door is not eligible.",
        conversion: "Among eligible tasks only: explicit purchase attempt, settlement, valid useful delivery, later useful call.",
        sample: {
          doors: doors.length,
          freeSufficient: freeSufficientDoors,
          paidAuditRequired: doors.filter((door) => door.paidAuditRequired === true).length,
          universalPaidDemandFalsified: false,
          recheckedThisRun: citedSample?.recheckedThisRun === true,
          source: citedSample?.source || null,
        },
        ineligibleSettlementsNotConverted: ineligiblePaidWithStages,
      },
    ),
    bountyContractReusedArtifact: experiment(
      "bounty-contract-reused-artifact",
      bountyEligible,
      bountyConverted,
      bountyEligible === 0 ? "download_is_not_verified_reuse" : "eligible_contract_only",
      {
        eligibility: "Current contract, reward present in the capture, artifact digest verified. A public tarball download is not eligible.",
        conversion: "Eligible contract, then a later task verifies reuse of that artifact. Settlement of the bounty is a separate fact.",
        downloadsObserved: downloads,
        launched: false,
      },
    ),
  };
}
