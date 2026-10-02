#!/usr/bin/env node
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compareArms } from "../src/compare.mjs";
import { startFixtureSeller } from "../src/fixture-seller.mjs";
import { normalizeIntake } from "../src/intake.mjs";
import { runJourney } from "../src/journey.mjs";
import { normalizeMachineRequest } from "../src/machine.mjs";
import { probeOnce } from "../src/probe.mjs";
import { assessPublicOrigin } from "../src/public-target.mjs";
import { rejectSeeded } from "../src/seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const command = process.argv[2];
const casePath = arg("--case");

if (command === "reject-seeded") {
  const file = process.argv[3];
  const claim = JSON.parse(await readFile(file, "utf8"));
  const result = rejectSeeded(claim);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.refused ? 2 : 1);
}

function envelope(result) {
  return {
    schema: "samedaydesk.seller-repair-diagnosis.v1",
    charged: false,
    paymentSent: result?.paymentSent === true,
    callerId: result?.callerId || null,
    operationId: result?.operationId || null,
    declaredSdk: result?.declaredSdk || null,
    target: result?.target || null,
    taskDigest: result?.taskDigest || null,
    usefulOutput: {
      matched: result?.classification?.useful === true,
      reason: result?.classification?.reason || null,
      outcome: result?.classification?.outcome || null,
      http200IsSuccess: false,
    },
    nextAction: result?.classification?.nextAction || null,
    observation: result?.observation || null,
    repair: result?.repair
      ? {
        useful: result.repair.useful === true,
        reason: result.repair.reason,
        changedOutput: result.repair.changedOutput || null,
        deployedCounterpartyRepair: false,
        counterpartyMutated: false,
      }
      : null,
    paid: {
      connected: result?.paidAudit?.connected === true,
      usefulDelta: result?.paidAudit?.usefulDelta === true,
      gap: result?.paidAudit?.gap || null,
      purchasePerformed: false,
      purchaseRecommended: false,
      answersUsefulOutput: false,
      priceDisplay: "$0.01",
      priceAtomic: "10000",
      route: "/commerce/seller-integrity-audit",
    },
    coverage: "unknown",
    adaptationMaintenanceCost: "unknown",
    tokens: "unknown",
    recognizedRevenueAtomic: "0",
    runtime: process.version,
  };
}

if (command === "diagnose") {
  if (!casePath) {
    process.stderr.write("case_required\n");
    process.exit(1);
  }
  try {
    const raw = JSON.parse(await readFile(casePath, "utf8"));
    const reportPath = arg("--report");
    const fileReport = reportPath ? JSON.parse(await readFile(reportPath, "utf8")) : null;
    const machineShaped = Boolean(raw.operation) && !raw.probeConsent && !raw.expectedUsefulOutput;
    const machine = machineShaped ? normalizeMachineRequest(raw) : null;
    if (machine?.unsupported) {
      process.stdout.write(`${JSON.stringify({ charged: false, paymentSent: false, usefulOutput: { matched: false, http200IsSuccess: false }, reason: machine.reason })}\n`);
      process.exit(0);
    }
    const live = arg("--live") === "probe" && machine?.probe !== false ? "auto" : "evidence";
    const result = await runJourney({
      intake: machine ? machine.intake : raw,
      baseUrl: machine ? machine.intake.origin : raw.origin,
      live,
      paidReport: fileReport || machine?.paidReport || null,
    });
    const body = envelope(result);
    process.stdout.write(`${JSON.stringify(body)}\n`);
    process.exit(body.paymentSent === false ? 0 : 1);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ charged: false, paymentSent: false, error: error.message, usefulOutput: { matched: false, http200IsSuccess: false } })}\n`);
    process.exit(1);
  }
}

if (command === "deliver") {
  const report = await deliverReport();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  const ok = report.privateTargetRefused === true
    && report.directBaselineAgrees === true
    && report.positive?.useful === true
    && report.negative?.useful === false
    && report.negative?.http200IsSuccess === false
    && report.tokens === "unknown"
    && report.adaptationMaintenanceCost === "unknown"
    && report.paymentSent === false
    && report.charged === false
    && report.deployedCounterpartyRepair === false;
  process.exit(ok ? 0 : 1);
}

async function deliverReport() {
  const offline = JSON.parse(await readFile(join(HERE, "../cases/supplied-offline.json"), "utf8"));
  const positiveJourney = await runJourney({
    intake: offline,
    baseUrl: offline.origin,
    live: "evidence",
  });
  const bare = {
    ...offline,
    callerId: "bare-caller",
    task: "Confirm whether a bare HTTP 200 from GET /v1/health contains status equal to ready.",
    callerEvidence: { observed: { status: 200, json: { note: "up" }, contentType: "application/json" } },
  };
  const negativeJourney = await runJourney({ intake: bare, baseUrl: bare.origin, live: "evidence" });
  const privateDecision = await assessPublicOrigin("https://intranet.example", {
    lookupImpl: async () => [{ address: "10.1.2.3", family: 4 }],
  });
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    const body = JSON.stringify({ status: "ready" });
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const baselineIntake = {
    callerId: "baseline-caller",
    task: "Confirm GET /v1/health on the caller baseline returns status equal to ready for node-https@22.",
    origin: "https://status.example",
    method: "GET",
    resource: "/v1/health",
    operation: { method: "GET", resource: "/v1/health", operationId: "GET /v1/health" },
    expectedUsefulOutput: { paths: ["status"], equals: { path: "status", value: "ready" } },
    declaredSdk: "node-https@22",
    declaredRuntime: `node/${process.versions.node}`,
    maxEffort: { probes: 4, bodyBytes: 4096, deadlineMs: 1000, totalBodyBytes: 16384, totalResponseMs: 4000, redirects: 0 },
    probeConsent: { class: "loopback", confirmed: true },
    question: "useful_output",
    paidIntent: false,
  };
  try {
    const direct = await probeOnce({ baseUrl, route: "/v1/health", deadlineMs: 1000, bodyBytes: 4096 });
    const compared = await runJourney({ intake: baselineIntake, baseUrl, live: "auto" });
    return {
      schema: "samedaydesk.seller-repair-deliver.v1",
      charged: false,
      paymentSent: false,
      tokens: "unknown",
      adaptationMaintenanceCost: "unknown",
      coverage: "unknown",
      runtime: process.version,
      deployedCounterpartyRepair: false,
      positive: {
        useful: positiveJourney.classification.useful === true,
        outcome: positiveJourney.classification.outcome,
        reason: positiveJourney.classification.reason,
        independentlyObserved: positiveJourney.observation.independentlyObserved,
        http200IsSuccess: false,
      },
      negative: {
        useful: negativeJourney.classification.useful === true,
        outcome: negativeJourney.classification.outcome,
        reason: negativeJourney.classification.reason,
        http200IsSuccess: false,
      },
      privateTargetRefused: privateDecision.ok === false && privateDecision.reason === "target_not_public",
      privateReason: privateDecision.reason,
      privateProbeCalls: 0,
      directBaselineAgrees: direct.digest === compared.observed?.digest && direct.json === true,
      directCalls: hits,
      callerEffortProbes: compared.metrics?.callerEffort?.probes ?? null,
      recognizedRevenueAtomic: "0",
    };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (!casePath) {
  process.stderr.write("case_required\n");
  process.exit(1);
}
const raw = JSON.parse(await readFile(casePath, "utf8"));
if (command === "readonly") {
  const { runJourney: run } = await import("../src/journey.mjs");
  const result = await run({ intake: raw, baseUrl: raw.origin });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.paymentSent === false && result.delivery?.deployedCounterpartyRepair === false ? 0 : 1);
}
if (command === "receive") {
  const base = arg("--base");
  if (!base) {
    process.stderr.write("base_required\n");
    process.exit(1);
  }
  const { runJourney: run } = await import("../src/journey.mjs");
  const result = await run({ intake: raw, baseUrl: base, retestBaseUrl: arg("--retest-base") });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const usefulRepair = result.repair?.useful === true;
  const usefulObservation = result.classification.useful === true && !result.repair;
  process.exit(usefulRepair || usefulObservation ? 0 : 1);
}
const seller = await startFixtureSeller();
try {
  if (command === "reproduce") {
    const result = await runJourney({
      intake: raw,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: "repaired",
      authorizeContribution: arg("--authorize") === "1",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.repair?.useful === true ? 0 : 1);
  }
  if (command === "retest") {
    const mode = arg("--mode") || "repaired";
    const result = await runJourney({
      intake: raw,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: mode,
    });
    process.stdout.write(`${JSON.stringify({ useful: result.repair?.useful === true, reason: result.repair?.reason || result.classification.reason })}\n`);
    process.exit(0);
  }
  if (command === "compare") {
    const intake = normalizeIntake(raw);
    const result = await compareArms({
      raw,
      intake,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: "repaired",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.repairUseful === true ? 0 : 1);
  }
  process.stderr.write("unknown_command\n");
  process.exit(1);
} finally {
  await seller.close();
}
