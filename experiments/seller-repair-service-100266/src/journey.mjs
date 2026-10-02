import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CASE_SCHEMA, SCHEMA, VERSION } from "./constants.mjs";
import { classify } from "./classify.mjs";
import { prepareContribution } from "./contribution.mjs";
import { declaredRequiredPaths } from "./declaration.mjs";
import { buildHandoff } from "./handoff.mjs";
import { normalizeIntake } from "./intake.mjs";
import { laterApplicability } from "./later.mjs";
import { measure } from "./measure.mjs";
import { probeDeclarationAndResource, publicObservation, summarize } from "./probe.mjs";
import { judgeRepair, reproductionCommand } from "./repair.mjs";
import { scanCaptured } from "./scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(readFileSync(path.join(here, "../SOURCE-PIN.json"), "utf8"));

function withoutBody(probe) {
  if (!probe) return null;
  const pub = publicObservation(probe);
  if (!pub) return null;
  const { body, ...rest } = pub;
  return rest;
}

export async function runJourney({
  intake: raw,
  baseUrl,
  fixtureMode = null,
  retestFixtureMode = null,
  authorizeContribution = false,
  merchantBase = null,
  fetchImpl = fetch,
  now = Date.now(),
  marker = null,
}) {
  const intake = normalizeIntake(raw);
  const probed = await probeDeclarationAndResource({ baseUrl, intake, fixtureMode });
  const declared = declaredRequiredPaths(probed.document, intake.resource, intake.method);
  const observed = probed.resourceProbe;
  const classification = classify({ intake, declared, observed: observed ? publicObservation(observed) : null });
  const scan = await scanCaptured({
    origin: intake.origin,
    method: intake.method,
    route: intake.resource,
    requiredPaths: intake.expectedUsefulOutput.paths,
    document: probed.document,
    resourceProbe: observed,
  });
  let retest = null;
  if (classification.outcome === "mismatch" && intake.patch && retestFixtureMode) {
    const again = await probeDeclarationAndResource({ baseUrl, intake, fixtureMode: retestFixtureMode });
    const retestObserved = again.resourceProbe ? publicObservation(again.resourceProbe) : null;
    retest = {
      ...judgeRepair({
        patch: intake.patch,
        beforeBody: observed?.body || null,
        document: probed.document,
        route: intake.resource,
        method: intake.method,
        expected: intake.expectedUsefulOutput,
        retestObserved,
      }),
      probe: summarize(again.resourceProbe),
    };
  }
  const handoff = await buildHandoff({ intake, merchantBase, fetchImpl });
  const paidAuditSolvesUsefulQuestion = false;
  let nextAction = classification.nextAction;
  if (classification.outcome === "free_sufficient") nextAction = "free_sufficient";
  if (intake.question === "semantic") nextAction = "unsupported";
  if (classification.outcome === "unknown" && classification.reason === "paid_body_not_read") nextAction = "unknown";
  const contribution = prepareContribution({
    intake,
    classification,
    patch: intake.patch,
    authorized: authorizeContribution === true,
    now,
    marker,
  });
  const later = laterApplicability({
    intake,
    taskDigest: intake.taskDigest,
    sdk: intake.declaredSdk,
    retest,
  });
  const metrics = measure({
    intake,
    classification,
    probes: probed.calls,
    retest,
    contribution,
    later,
    paid: { actualValidDelivery: false },
  });
  return {
    schema: SCHEMA,
    caseSchema: CASE_SCHEMA,
    version: VERSION,
    pins,
    taskDigest: intake.taskDigest,
    declaredSdk: intake.declaredSdk,
    declaredRuntime: intake.declaredRuntime,
    target: { origin: intake.origin, method: intake.method, resource: intake.resource },
    expectedUsefulOutput: intake.expectedUsefulOutput,
    declared,
    observed: withoutBody(observed),
    callerSupplied: classification.callerSupplied,
    classification: {
      outcome: classification.outcome,
      reason: classification.reason,
      useful: classification.useful,
      http200IsSuccess: false,
      paidAuditRequired: false,
      nextAction,
    },
    scan,
    paidAudit: {
      adds: scan.adds,
      doesNotAdd: scan.doesNotAdd,
      solvesCallerSemanticOrBodyQuestion: paidAuditSolvesUsefulQuestion,
      required: false,
      purchasePerformed: false,
    },
    reproductionCommand: reproductionCommand(),
    repair: retest,
    handoff,
    contribution,
    later,
    metrics,
    paymentSent: false,
    revenueRecognized: false,
    recognizedRevenueAtomic: "0",
    historicalRevenue: "unknown",
  };
}

export function publicCase(result) {
  return {
    schema: CASE_SCHEMA,
    taskDigest: result.taskDigest,
    declaredSdk: result.declaredSdk,
    target: result.target,
    expectedUsefulOutput: result.expectedUsefulOutput,
    classification: result.classification,
    reproductionCommand: result.reproductionCommand,
    repairUseful: result.repair?.useful === true,
    paymentPermitted: false,
    spendingGrantTransferred: false,
  };
}
