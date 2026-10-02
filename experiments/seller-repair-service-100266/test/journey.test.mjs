import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compareArms } from "../src/compare.mjs";
import { replayContribution, revokeContribution, correctContribution } from "../src/contribution.mjs";
import { PRIVATE_MARKER } from "../src/constants.mjs";
import { SellerRepairError } from "../src/errors.mjs";
import { startFixtureSeller } from "../src/fixture-seller.mjs";
import { normalizeIntake } from "../src/intake.mjs";
import { runJourney } from "../src/journey.mjs";
import { rejectSeeded } from "../src/seed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const casePath = path.join(here, "../cases/retained-case.json");
const retained = JSON.parse(await readFile(casePath, "utf8"));

async function journey(mode, patch = {}, options = {}) {
  const seller = await startFixtureSeller();
  try {
    return await runJourney({
      intake: { ...retained, ...patch },
      baseUrl: seller.baseUrl,
      fixtureMode: mode,
      ...options,
    });
  } finally {
    await seller.close();
  }
}

test("truthful free declaration is sufficient and a required array is not execution", async () => {
  const result = await journey("truthful");
  assert.equal(result.classification.outcome, "free_sufficient");
  assert.equal(result.classification.paidAuditRequired, false);
  assert.equal(result.declared.provesExecution, false);
  assert.equal(result.declared.provesUsefulEquivalence, false);
  assert.equal(result.observed.http200IsSuccess, false);
  assert.equal(result.observed.status, 200);
  assert.equal(result.scan.ran, true, JSON.stringify(result.scan));
  assert.equal(result.scan.findings.includes("expected_402_received_200"), true);
  assert.equal(result.scan.boundary.sellerRuntimeVerified, false);
  assert.equal(result.scan.boundary.bodyForwardedToScanner, false);
  assert.equal(result.paidAudit.solvesCallerSemanticOrBodyQuestion, false);
  assert.equal(result.paymentSent, false);
  assert.equal(result.metrics.cashAtomic, "unknown");
  assert.equal(result.metrics.tokens, "unknown");
  assert.equal(result.metrics.recognizedRevenueAtomic, "0");
  assert.equal(result.metrics.includedQuotaApiEquivalentEffort.countsAsCash, false);
});

test("a missing field does not prove a paid audit is necessary", async () => {
  const result = await journey("missing-field");
  assert.equal(result.classification.outcome, "unknown");
  assert.equal(result.classification.reason, "missing_field_not_paid_demand");
  assert.equal(result.paidAudit.required, false);
  assert.equal(result.handoff.purchasePerformed, false);
});

test("live body that contradicts its declaration can be repaired and independently retested", async () => {
  const result = await journey("contradict", {}, { retestFixtureMode: "repaired" });
  assert.equal(result.classification.outcome, "mismatch");
  assert.equal(result.classification.reason, "body_contradicts_declaration");
  assert.equal(result.callerSupplied.executed, false);
  assert.equal(result.repair.useful, true);
  assert.equal(result.repair.reason, "retest_matched");
  assert.equal(result.repair.independent, true);
  assert.equal(result.repair.http200IsSuccess, false);
  assert.match(result.reproductionCommand, /seller-repair.mjs reproduce/);
});

test("incomplete and incorrect repairs fail the independent retest", async () => {
  const incomplete = await journey("contradict", {
    patch: { kind: "incomplete", instructions: ["rename only"], responseOverlay: { result: { name: "Widget" } } },
  }, { retestFixtureMode: "incomplete" });
  assert.equal(incomplete.repair.useful, false);
  assert.equal(incomplete.repair.reason, "repair_incomplete");

  const incorrect = await journey("contradict", {
    patch: { kind: "incorrect", instructions: ["drop result.sku from required"], dropRequiredPaths: ["result.sku"] },
  }, { retestFixtureMode: "incorrect" });
  assert.equal(incorrect.repair.useful, false);
  assert.equal(incorrect.repair.reason, "declaration_edit_is_not_useful_output");
});

test("changed caller evidence cannot replace observed execution", async () => {
  const result = await journey("contradict", {
    callerEvidence: { status: 200, paths: ["result.sku"], equals: "WIDGET-1" },
  });
  assert.equal(result.classification.outcome, "mismatch");
  assert.equal(result.callerSupplied.present, true);
  assert.equal(result.callerSupplied.executed, false);
  assert.equal(result.callerSupplied.establishesUsefulOutput, false);
});

test("semantic questions stay unsupported instead of a forced purchase", async () => {
  const result = await journey("truthful", { question: "semantic", paidIntent: true });
  assert.equal(result.classification.outcome, "unsupported");
  assert.equal(result.classification.nextAction, "unsupported");
  assert.equal(result.paidAudit.required, false);
  assert.equal(result.handoff.purchasePerformed, false);
  assert.equal(result.metrics.qualifiedPaidIntent, 1);
  assert.equal(result.metrics.actualValidDelivery, 0);
});

test("private sentinel, redirect, deadline, and unpaid 402 stay non-useful", async () => {
  const hidden = await journey("private");
  assert.equal(hidden.classification.reason, "private_body_withheld");
  assert.equal(JSON.stringify(hidden).includes(PRIVATE_MARKER), false);

  const redirected = await journey("redirect");
  assert.equal(redirected.classification.reason, "redirect_unfollowed");
  assert.equal(redirected.observed.redirectUnfollowed, true);

  const slow = await journey("slow", {
    maxEffort: { probes: 2, bodyBytes: 4096, deadlineMs: 40, totalBodyBytes: 8192, totalResponseMs: 80, redirects: 0 },
  });
  assert.equal(slow.classification.reason, "body_deadline");
  assert.equal(JSON.stringify(slow).includes(PRIVATE_MARKER), false);

  const unpaid = await journey("paid");
  assert.equal(unpaid.classification.reason, "paid_body_not_read");
  assert.equal(unpaid.handoff.purchasePerformed, false);
  assert.equal(unpaid.paidAudit.required, false);
});

test("malformed intake is uncharged and makes no probe", async () => {
  assert.throws(() => normalizeIntake({ ...retained, origin: "http://seller.example" }), SellerRepairError);
  assert.throws(() => normalizeIntake({ ...retained, task: "too short" }), SellerRepairError);
  assert.throws(() => normalizeIntake({ ...retained, wallet: "0xabc" }), SellerRepairError);
  try {
    normalizeIntake({ ...retained, origin: "not a url" });
    assert.fail("expected intake error");
  } catch (error) {
    assert.equal(error.charged, false);
  }
});

test("authorized contribution supports correction, expiry, revocation, and independent replay", async () => {
  const result = await journey("contradict", {}, { authorizeContribution: true, retestFixtureMode: "repaired" });
  assert.equal(result.contribution.accepted, true);
  assert.equal(result.contribution.existingKnowledgePath.receiptSharesReturned, 0);
  assert.equal(result.contribution.spendingGrantTransferred, false);
  const boundTarget = { origin: result.target.origin, method: result.target.method, resource: result.target.resource };
  const hashOnly = replayContribution({
    contribution: result.contribution,
    now: Date.parse(result.contribution.row.expiresAt) - 1000,
    taskDigest: result.taskDigest,
    sdk: result.declaredSdk,
    target: boundTarget,
  });
  assert.equal(hashOnly.reused, false);
  assert.equal(hashOnly.reason, "hash_is_not_execution");
  assert.equal(hashOnly.hashIsExecution, false);
  const replay = replayContribution({
    contribution: result.contribution,
    now: Date.parse(result.contribution.row.expiresAt) - 1000,
    taskDigest: result.taskDigest,
    sdk: result.declaredSdk,
    target: boundTarget,
    execution: {
      independent: true,
      callerId: "later-agent",
      operationId: result.operationId,
      observedDigest: result.observed.digest,
    },
  });
  assert.equal(replay.reused, true);
  assert.equal(replay.reason, "independent_execution");
  assert.equal(replay.usefulTransferred, false);
  assert.equal(replay.hashIsExecution, false);
  assert.equal(replay.receiptSharesReturned, 0);
  const revoked = revokeContribution(result.contribution);
  const afterRevoke = replayContribution({
    contribution: result.contribution,
    revocations: [revoked],
    taskDigest: result.taskDigest,
    sdk: result.declaredSdk,
    target: boundTarget,
  });
  assert.equal(afterRevoke.reason, "revoked");
  const corrected = correctContribution(result.contribution, {
    replacement: {
      intake: normalizeIntake(retained),
      classification: result.classification,
      patch: retained.patch,
    },
  });
  const afterCorrect = replayContribution({
    contribution: result.contribution,
    corrections: [corrected.control],
    taskDigest: result.taskDigest,
    sdk: result.declaredSdk,
    target: boundTarget,
  });
  assert.equal(afterCorrect.reason, "corrected");
  const expired = replayContribution({
    contribution: result.contribution,
    now: Date.parse(result.contribution.row.expiresAt) + 1,
    taskDigest: result.taskDigest,
    sdk: result.declaredSdk,
    target: boundTarget,
  });
  assert.equal(expired.reason, "expired");
  const stale = replayContribution({
    contribution: result.contribution,
    taskDigest: result.taskDigest,
    sdk: "python-httpx@1",
    target: boundTarget,
  });
  assert.equal(stale.reason, "stale_applicability");
  const moved = replayContribution({
    contribution: result.contribution,
    taskDigest: result.taskDigest,
    sdk: result.declaredSdk,
    target: { ...boundTarget, resource: "/catalog/items" },
  });
  assert.equal(moved.reason, "stale_applicability");
  const withheld = await journey("private", {}, { authorizeContribution: true });
  assert.equal(withheld.contribution.accepted, false);
  assert.equal(withheld.contribution.reason, "private_material");
});

test("direct probe sees the bytes and the open scanner does not answer the useful question", async () => {
  const seller = await startFixtureSeller();
  try {
    const intake = normalizeIntake(retained);
    const compared = await compareArms({
      raw: retained,
      intake,
      baseUrl: seller.baseUrl,
      fixtureMode: "contradict",
      retestFixtureMode: "repaired",
    });
    assert.equal(compared.direct.http200IsSuccess, false);
    assert.equal(compared.direct.paths.includes("result.sku"), false);
    assert.equal(compared.direct.repairProduced, false);
    assert.equal(compared.direct.paidAuditRequired, false);
    assert.equal(compared.open.solvesUsefulOutput, false);
    assert.equal(compared.open.bodyReadByScanner, false);
    assert.equal(compared.open.sellerRuntimeVerified, false);
    assert.equal(compared.open.findings.includes("expected_402_received_200"), true);
    assert.equal(compared.repairUseful, true);
    assert.equal(compared.paymentSent, false);
  } finally {
    await seller.close();
  }
});

test("seeded false usefulness is refused", () => {
  const claim = JSON.parse(readFileSync(path.join(here, "../fixtures/seeded-false-useful.json"), "utf8"));
  const refused = rejectSeeded(claim);
  assert.equal(refused.refused, true);
  assert.equal(refused.reasons.includes("http200_is_not_useful"), true);
  assert.equal(refused.reasons.includes("forced_purchase"), true);
  assert.equal(refused.reasons.includes("revenue_claim"), true);
  assert.equal(refused.recognizedRevenueAtomic, "0");
});

test("reproduce command exits 0 and reject-seeded exits 2", async () => {
  const reproduced = await runNode(["experiments/seller-repair-service-100266/bin/seller-repair.mjs", "reproduce", "--case", "experiments/seller-repair-service-100266/cases/retained-case.json"]);
  assert.equal(reproduced.code, 0, reproduced.stderr);
  const body = JSON.parse(reproduced.stdout);
  assert.equal(body.repair.useful, true);
  assert.equal(body.paymentSent, false);
  const seeded = await runNode(["experiments/seller-repair-service-100266/bin/seller-repair.mjs", "reject-seeded", "experiments/seller-repair-service-100266/fixtures/seeded-false-useful.json"]);
  assert.equal(seeded.code, 2, seeded.stdout);
  assert.equal(JSON.parse(seeded.stdout).refused, true);
});

function runNode(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("two cold processes use the retained case without producer state", async () => {
  const same = runNode(["experiments/seller-repair-service-100266/bin/cold-later.mjs", "experiments/seller-repair-service-100266/cases/retained-case.json"]);
  const changed = runNode([
    "experiments/seller-repair-service-100266/bin/cold-later.mjs",
    "experiments/seller-repair-service-100266/cases/retained-case.json",
    "--sdk",
    "python-httpx@1",
  ]);
  const changedTask = runNode([
    "experiments/seller-repair-service-100266/bin/cold-later.mjs",
    "experiments/seller-repair-service-100266/cases/retained-case.json",
    "--task",
    "A different later task asks for a price quote rather than the catalog sku constant.",
  ]);
  const blocked = runNode([
    "experiments/seller-repair-service-100266/bin/cold-later.mjs",
    "experiments/seller-repair-service-100266/cases/retained-case.json",
  ], { SELLER_REPAIR_PRIVATE: "1" });
  const [kept, stale, otherTask, refused] = await Promise.all([same, changed, changedTask, blocked]);
  assert.equal(kept.code, 0, kept.stderr);
  const keptBody = JSON.parse(kept.stdout);
  assert.equal(keptBody.reused, true);
  assert.equal(keptBody.privateImported, false);
  assert.equal(keptBody.paymentSent, false);
  assert.equal(stale.code, 2, stale.stderr);
  const staleBody = JSON.parse(stale.stdout);
  assert.equal(staleBody.reason, "stale_applicability");
  assert.equal(staleBody.currentTask, true);
  assert.equal(staleBody.currentSdk, false);
  assert.equal(staleBody.repairApplied, false);
  assert.equal(staleBody.usefulTransferred, false);
  assert.equal(otherTask.code, 2, otherTask.stderr);
  const otherBody = JSON.parse(otherTask.stdout);
  assert.equal(otherBody.reason, "stale_applicability");
  assert.equal(otherBody.currentTask, false);
  assert.equal(otherBody.currentSdk, true);
  assert.equal(otherBody.repairApplied, false);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /producer_state_present/);
});
