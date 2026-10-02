import { classify } from "./classify.mjs";
import { declaredRequiredPaths } from "./declaration.mjs";
import { probeDeclarationAndResource, publicObservation } from "./probe.mjs";
import { scanCaptured } from "./scan.mjs";
import { runJourney } from "./journey.mjs";

export async function directProbe({ intake, baseUrl, fixtureMode }) {
  const probed = await probeDeclarationAndResource({ baseUrl, intake, fixtureMode });
  const observed = probed.resourceProbe ? publicObservation(probed.resourceProbe) : null;
  return {
    arm: "direct_probe",
    equipped: { deadlineMs: intake.maxEffort.deadlineMs, bodyBytes: intake.maxEffort.bodyBytes, redirectsFollowed: false, paymentSent: false },
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
  const scan = await scanCaptured({
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
    paymentSent: false,
    recognizedRevenueAtomic: "0",
  };
}
