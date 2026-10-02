import { classify } from "./classify.mjs";
import { declaredRequiredPaths } from "./declaration.mjs";
import { normalizeIntake } from "./intake.mjs";
import { probeDeclarationAndResource, publicObservation } from "./probe.mjs";
import { runJourney } from "./journey.mjs";

async function scanOptional(args) {
  try {
    const mod = await import("./scan.mjs");
    return await mod.scanCaptured(args);
  } catch (error) {
    const message = String(error?.message || error);
    if (error?.code === "ERR_MODULE_NOT_FOUND" || message.includes("Cannot find package") || message.includes("Cannot find module")) {
      return {
        ran: false,
        findings: [],
        repairPlan: null,
        coverage: "unknown",
        boundary: { sellerRuntimeVerified: false },
      };
    }
    throw error;
  }
}

export async function directProbe({ intake, baseUrl, fixtureMode }) {
  const probed = await probeDeclarationAndResource({ baseUrl, intake, fixtureMode });
  const observed = probed.resourceProbe ? publicObservation(probed.resourceProbe) : null;
  return {
    arm: "direct_probe",
    equipped: {
      deadlineMs: intake.maxEffort.deadlineMs,
      totalResponseMs: intake.maxEffort.totalResponseMs,
      bodyBytes: intake.maxEffort.bodyBytes,
      totalBodyBytes: intake.maxEffort.totalBodyBytes,
      redirects: intake.maxEffort.redirects,
      redirectsFollowed: false,
      paymentSent: false,
    },
    status: observed?.status ?? null,
    byteLength: observed?.byteLength ?? 0,
    paths: observed?.paths || [],
    http200IsSuccess: false,
    repairProduced: false,
    laterApplicability: false,
    paidAuditRequired: false,
  };
}

export async function openImplementation({ intake, baseUrl, fixtureMode }) {
  const probed = await probeDeclarationAndResource({ baseUrl, intake, fixtureMode });
  const declared = declaredRequiredPaths(probed.document, intake.resource, intake.method);
  const scan = await scanOptional({
    origin: intake.origin,
    method: intake.method,
    route: intake.resource,
    requiredPaths: intake.expectedUsefulOutput.paths,
    document: probed.document,
    resourceProbe: probed.resourceProbe,
  });
  const observed = probed.resourceProbe ? publicObservation(probed.resourceProbe) : null;
  const bodyClass = classify({ intake, declared, observed });
  return {
    arm: "open_scanner",
    declarationRequiredPaths: declared.requiredPaths,
    provesExecution: false,
    findings: scan.findings,
    repairPlanMode: scan.repairPlan?.mode || null,
    sellerRuntimeVerified: scan.repairPlan?.boundary?.sellerRuntimeVerified === true,
    bodyReadByScanner: false,
    bodyClassificationIgnoredByScanner: bodyClass.outcome,
    solvesUsefulOutput: false,
    paidAuditRequired: false,
    purchasePerformed: false,
  };
}

export async function compareArms({ raw, intake, baseUrl, fixtureMode, retestFixtureMode }) {
  const direct = await directProbe({ intake, baseUrl, fixtureMode });
  const open = await openImplementation({ intake, baseUrl, fixtureMode });
  const repair = await runJourney({ intake: raw, baseUrl, fixtureMode, retestFixtureMode });
  const directSawMissingPath = intake.expectedUsefulOutput.paths.some((path) => !direct.paths.includes(path));
  return {
    direct,
    open,
    repairOutcome: repair.classification.outcome,
    repairUseful: repair.repair?.useful === true,
    directSawMismatchBytes: directSawMissingPath && direct.http200IsSuccess === false,
    openSolvesUsefulOutput: open.solvesUsefulOutput,
    addedByRepairCase: [
      "task_sdk_binding",
      "declared_versus_observed_separation",
      "patch_fixture_and_independent_retest",
      "later_sdk_or_task_refusal",
      "unforced_paid_handoff",
    ],
    notClaimed: "The direct probe can see the same missing path. The repair case adds the bound retest and the refusal to purchase.",
    loopbackFix: repair.delivery?.loopbackFix === true,
    deployedCounterpartyRepair: false,
    sameInputQa: repair.delivery?.sameInputQa === true,
    laterCallerReuse: false,
    actualSourceCoverage: "unknown",
    paymentSent: false,
    recognizedRevenueAtomic: "0",
  };
}

export async function compareBeforeAfter({ raw, beforeBaseUrl, afterBaseUrl }) {
  const intake = normalizeIntake(raw);
  const before = await runJourney({ intake: raw, baseUrl: beforeBaseUrl });
  const repaired = await runJourney({ intake: raw, baseUrl: beforeBaseUrl, retestBaseUrl: afterBaseUrl });
  return {
    equallyEquipped: {
      deadlineMs: intake.maxEffort.deadlineMs,
      totalResponseMs: intake.maxEffort.totalResponseMs,
      bodyBytes: intake.maxEffort.bodyBytes,
      totalBodyBytes: intake.maxEffort.totalBodyBytes,
      redirects: intake.maxEffort.redirects,
      redirectsFollowed: false,
      paymentSent: false,
    },
    beforeOutcome: before.classification.outcome,
    beforeUseful: before.classification.useful === true,
    afterUseful: repaired.repair?.useful === true,
    usefulOutputChanged: before.classification.useful !== true && repaired.repair?.useful === true,
    loopbackFix: repaired.delivery.loopbackFix === true,
    deployedCounterpartyRepair: false,
    counterpartyMutated: false,
    sameInputQa: repaired.delivery.sameInputQa === true,
    laterCallerReuse: false,
    http200IsSuccess: false,
    paidAuditRequired: false,
    actualSourceCoverage: "unknown",
    paymentSent: false,
    recognizedRevenueAtomic: "0",
  };
}
