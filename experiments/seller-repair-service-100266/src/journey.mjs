import { readFileSync } from "node:fs";

import { authorizeTarget } from "./authorize.mjs";
import { createBudget } from "./budget.mjs";
import { AUDIT_ADDS, AUDIT_DOES_NOT, CASE_SCHEMA, PAID_METHOD, PAID_PRICE_ATOMIC, PAID_PRICE_DISPLAY, PAID_PRODUCT, PAID_ROUTE, PAID_VERSION, SCHEMA, VERSION } from "./constants.mjs";
import { classify } from "./classify.mjs";
import { declaredRequiredPaths } from "./declaration.mjs";
import { normalizeIntake } from "./intake.mjs";
import { laterApplicability } from "./later.mjs";
import { measure } from "./measure.mjs";
import { paidDeltaForCaller } from "./paid-report.mjs";
import { observationFromEvidence, probeDeclarationAndResource, publicObservation, summarize } from "./probe.mjs";
import { publicOriginShape } from "./public-target.mjs";
import { judgeRepair, reproductionCommand } from "./repair.mjs";

function loadPins() {
  try {
    return JSON.parse(readFileSync(new URL("../SOURCE-PIN.json", import.meta.url), "utf8"));
  } catch {
    return { portable: true, scanner: "not_bundled", actualSourceCoverage: "unknown" };
  }
}

const pins = loadPins();

function missingModule(error) {
  const code = error?.code;
  const message = String(error?.message || error);
  return code === "ERR_MODULE_NOT_FOUND" || message.includes("Cannot find package") || message.includes("Cannot find module");
}

async function loadOptional(specifier) {
  try {
    return await import(specifier);
  } catch (error) {
    if (missingModule(error)) return null;
    throw error;
  }
}

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
  retestBaseUrl = null,
  fixtureMode = null,
  retestFixtureMode = null,
  authorizeContribution = false,
  merchantBase = null,
  fetchImpl = fetch,
  now = Date.now(),
  marker = null,
  lookupImpl = null,
  socket = null,
  retestSocket = null,
  live = "auto",
  paidReport = null,
}) {
  const intake = normalizeIntake(raw);
  const evidenceObservation = observationFromEvidence(intake);
  const evidenceOnly = live === "evidence";
  let gate = evidenceOnly
    ? { ok: true, transport: intake.probeConsent.class }
    : await authorizeTarget({ intake, baseUrl, lookupImpl });
  if (evidenceOnly && intake.probeConsent.class === "public-https") {
    const shape = publicOriginShape(intake.origin);
    if (!shape.ok) gate = shape;
  }
  const retestGate = !retestBaseUrl || evidenceOnly
    ? { ok: true }
    : await authorizeTarget({ intake, baseUrl: retestBaseUrl, lookupImpl });
  const budget = createBudget(intake.maxEffort, typeof now === "number" ? now : Date.now());
  let liveAdapter = evidenceOnly ? "evidence" : "live";
  let dnsFailure = null;
  let denied = !gate.ok || !retestGate.ok;
  if (!gate.ok && gate.reason === "dns_failed" && retestGate.ok && evidenceObservation && intake.probeConsent.class === "public-https") {
    denied = false;
    liveAdapter = "absent";
    dnsFailure = gate.reason;
  }
  const samePin = (pinned, fresh) => {
    if (!pinned?.resolved || !fresh?.resolved) return true;
    return pinned.resolved.address === fresh.resolved.address
      && Number(pinned.resolved.family) === Number(fresh.resolved.family);
  };
  const beforeProbe = evidenceOnly || liveAdapter === "absent"
    ? null
    : async () => {
      if (intake.probeConsent.class !== "public-https") return { ok: true, socket };
      const fresh = await authorizeTarget({ intake, baseUrl, lookupImpl });
      if (!fresh.ok) return fresh;
      if (!samePin(gate, fresh)) return { ok: false, reason: "dns_changed", transport: "public-https" };
      return { ok: true, lookup: fresh.lookup, socket };
    };
  const probed = denied
    ? { document: null, resourceProbe: null, calls: [], stopped: gate.ok ? retestGate.reason : gate.reason, budget }
    : liveAdapter === "live"
      ? await probeDeclarationAndResource({ baseUrl, intake, fixtureMode, budget, beforeProbe })
      : { document: null, resourceProbe: evidenceObservation, calls: [], stopped: null, budget };
  const declared = declaredRequiredPaths(probed.document, intake.resource, intake.method);
  const observed = probed.resourceProbe;
  const classification = classify({
    intake,
    declared,
    observed: observed ? publicObservation(observed) : null,
    stopped: probed.stopped,
  });
  const scanModule = await loadOptional("./scan.mjs");
  const scan = scanModule
    ? await scanModule.scanCaptured({
      origin: intake.origin,
      method: intake.method,
      route: intake.resource,
      requiredPaths: intake.expectedUsefulOutput.paths,
      document: probed.document,
      resourceProbe: observed
        ? { status: observed.status, contentType: observed.contentType }
        : null,
    })
    : {
      ran: false,
      reason: "scanner_not_in_portable_consumer",
      findings: [],
      repairPlan: null,
      adds: AUDIT_ADDS,
      doesNotAdd: AUDIT_DOES_NOT,
      coverage: "unknown",
      solvesUsefulOutput: false,
      boundary: { bodyForwardedToScanner: false, paymentSent: false, sellerRuntimeVerified: false },
    };
  let retest = null;
  const retestBase = retestBaseUrl || baseUrl;
  if (!denied && liveAdapter === "live" && classification.outcome === "mismatch" && intake.patch && (retestFixtureMode || retestBaseUrl)) {
    const retestProbe = async () => {
      if (intake.probeConsent.class !== "public-https") return { ok: true, socket: retestSocket || socket };
      const fresh = await authorizeTarget({ intake, baseUrl: retestBase, lookupImpl });
      if (!fresh.ok) return fresh;
      const stick = retestGate.resolved ? retestGate : gate;
      if (!samePin(stick, fresh)) return { ok: false, reason: "dns_changed", transport: "public-https" };
      return { ok: true, lookup: fresh.lookup, socket: retestSocket || socket };
    };
    const again = await probeDeclarationAndResource({
      baseUrl: retestBase,
      intake,
      fixtureMode: retestFixtureMode,
      budget,
      beforeProbe: retestProbe,
    });
    const retestObserved = again.resourceProbe ? publicObservation(again.resourceProbe) : null;
    const judged = again.resourceProbe
      ? judgeRepair({
        patch: intake.patch,
        beforeBody: observed?.privateSentinel ? null : (observed?.body || null),
        document: probed.document,
        route: intake.resource,
        method: intake.method,
        expected: intake.expectedUsefulOutput,
        retestObserved,
      })
      : { useful: false, reason: again.stopped || "retest_not_observed", independent: true, http200IsSuccess: false };
    const equalsPath = intake.expectedUsefulOutput.equals?.path || intake.expectedUsefulOutput.paths[0];
    retest = {
      ...judged,
      probe: summarize(again.resourceProbe),
      class: intake.probeConsent.class === "loopback" ? "loopback_fix" : "caller_reviewed_retest",
      changedOutput: {
        path: equalsPath,
        before: observed?.privateSentinel ? null : (observed?.values?.[equalsPath] ?? null),
        after: retestObserved?.values?.[equalsPath] ?? null,
      },
      counterpartyMutated: false,
      deployedCounterpartyRepair: false,
      callerReviewed: true,
      sameInputQa: true,
      laterCaller: false,
    };
  }
  const handoffModule = await loadOptional("./handoff.mjs");
  const handoff = handoffModule
    ? await handoffModule.buildHandoff({ intake, merchantBase, fetchImpl })
    : {
      request: { method: PAID_METHOD, route: PAID_ROUTE, product: PAID_PRODUCT, version: PAID_VERSION },
      price: { display: PAID_PRICE_DISPLAY, atomic: PAID_PRICE_ATOMIC, authority: "documented_existing_route", priceChanged: false, skuAdded: false },
      purchasePerformed: false,
      paymentSent: false,
      revenueRecognized: false,
    };
  const paidDelta = paidDeltaForCaller({
    question: intake.question,
    freeNextAction: classification.nextAction,
    report: paidReport,
    intake,
  });
  const paidAuditSolvesUsefulQuestion = false;
  let nextAction = paidDelta.nextAction;
  if (classification.outcome === "free_sufficient") nextAction = "free_sufficient";
  if (intake.question === "semantic") nextAction = "unsupported";
  if (classification.outcome === "unknown" && classification.reason === "paid_body_not_read") nextAction = "unknown";
  const contributionModule = await loadOptional("./contribution.mjs");
  const contribution = contributionModule
    ? contributionModule.prepareContribution({
      intake,
      classification,
      patch: intake.patch,
      authorized: authorizeContribution === true,
      now,
      marker,
    })
    : { accepted: false, reason: "contribution_authority_unavailable", paymentPermitted: false, spendingGrantTransferred: false, usefulTransferred: false };
  const later = laterApplicability({
    intake,
    taskDigest: intake.taskDigest,
    sdk: intake.declaredSdk,
    target: { origin: intake.origin, method: intake.method, resource: intake.resource },
    callerId: intake.callerId,
    retest,
    independentRetest: Boolean(retest),
  });
  const paidReportView = paidDelta;
  const metrics = measure({
    intake,
    classification,
    probes: probed.calls,
    retest,
    contribution,
    later,
    paid: { actualValidDelivery: false },
    budget,
  });
  return {
    schema: SCHEMA,
    caseSchema: CASE_SCHEMA,
    version: VERSION,
    pins,
    taskDigest: intake.taskDigest,
    callerId: intake.callerId,
    operationId: intake.operationId,
    declaredSdk: intake.declaredSdk,
    declaredRuntime: intake.declaredRuntime,
    probeConsent: intake.probeConsent,
    target: { origin: intake.origin, method: intake.method, resource: intake.resource },
    expectedUsefulOutput: intake.expectedUsefulOutput,
    declared,
    observed: withoutBody(observed),
    callerSupplied: classification.callerSupplied,
    observation: {
      source: liveAdapter === "live" ? "live" : "caller_supplied",
      independentlyObserved: liveAdapter === "live" && Boolean(observed) && observed.privateSentinel !== true,
      liveAdapter,
      dnsFailure,
      http200IsSuccess: false,
    },
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
      answersUsefulOutput: paidReportView.answersUsefulOutput,
      purchaseRecommended: paidReportView.purchaseRecommended,
      connected: paidReportView.connected,
      usefulDelta: paidReportView.usefulDelta,
      gap: paidReportView.gap,
      required: false,
      purchasePerformed: false,
    },
    delivery: {
      usefulDelivery: metrics.usefulDelivery,
      observedCaseRepair: metrics.observedCaseRepair === 1,
      laterApplicableReuse: metrics.laterApplicableReuse === 1,
      loopbackFix: retest?.class === "loopback_fix" && retest?.useful === true,
      callerReviewedRetest: retest?.class === "caller_reviewed_retest" && retest?.useful === true,
      deployedCounterpartyRepair: false,
      sameInputQa: later.sameInputQa === true,
      laterCaller: false,
      actualSourceCoverage: "unknown",
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
