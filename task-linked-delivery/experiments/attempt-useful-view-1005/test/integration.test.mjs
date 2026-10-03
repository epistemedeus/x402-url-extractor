import { boot } from "./mounted.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import { createCommerceTelemetry } from "../../../../commerce-events.mjs";
import { CUSTOMER_MAX_RECORD_BYTES } from "../../../../useful-result-reuse/constants.mjs";
import { mountUsefulResultReuse } from "../../../../useful-result-reuse/http.mjs";
import { createReuseStore } from "../../../../useful-result-reuse/store.mjs";
import { transactionReceipt } from "../../../../transaction-receipt.mjs";
import { feeHash, fixtureClient } from "../../free-task-observation-100421/test/receipt-fixtures.mjs";
import { nodePort, TOKEN } from "../../free-task-observation-100421/test/native-ports.mjs";
import { merchant161ObservationMount } from "../src/enroll.mjs";
import { readPersistedAttempt, stageWords } from "../src/read.mjs";
import { integrationDeltaState } from "../src/delta.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const baseline = JSON.parse(readFileSync(fileURLToPath(new URL("../../production-funnel-100423/evidence/baseline.stripped.json", import.meta.url)), "utf8"));
const SECRET = "synthetic-free-observation-actor-secret-100421";
const ABSENT = `t${"ab".repeat(31)}`;

function forkWorker(input) {
  const child = fork(fileURLToPath(new URL("../src/restart-worker.mjs", import.meta.url)), [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("restart_deadline"));
    }, 20000);
    let message;
    child.on("message", (value) => {
      message = value;
    });
    child.once("exit", () => {
      clearTimeout(timer);
      if (!message) reject(new Error("restart_silent"));
      else resolve(message);
    });
    child.send(input);
  });
}


test("enrolled persistence binds the real attempt and delivery and leaves live coverage unresolved", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "attempt-useful-"));
  const app = await boot(dataDir);
  try {
    const observed = await nodePort("caller.mjs", {
      base: app.base,
      token: TOKEN,
      hash: feeHash,
      label: "sol421-fee-complete",
    });
    assert.equal(observed.httpStatus, 200);
    assert.equal(observed.result.accepted, true, JSON.stringify(observed.result));
    assert.equal(observed.result.paymentPermitted, false);
    const report = await readPersistedAttempt({
      dataDir,
      internalToken: TOKEN,
      cut: await app.capture.capture(),
      taskRef: observed.request.taskRef,
      baseline,
      link: {
        taskRef: observed.request.taskRef,
        commerceEventId: observed.request.commerceEventId,
        operationId: observed.request.operationId,
        responseDigest: observed.result.observation.responseDigest,
      },
    });
    assert.equal(report.decision, "one_attempt");
    assert.equal(report.taskRef, observed.request.taskRef);
    assert.equal(report.commerceEventId, observed.request.commerceEventId);
    assert.equal(report.operationId, observed.request.operationId);
    assert.equal(report.stages.attempt.disposition, "producer-observed");
    assert.equal(report.stages.delivery.disposition, "producer-observed");
    assert.equal(report.stages.settlement.disposition, "unresolved");
    assert.equal(report.stages.settlement.observed, "unknown");
    assert.equal(stageWords(report).settlement, "unknown");
    assert.equal(stageWords(report).delivery, "producer-observed");
    assert.equal(JSON.stringify(stageWords(report)).includes(":0"), false);
    assert.equal(report.liveCoverage, "unresolved");
    assert.notEqual(report.liveCoverage, true);
    assert.notEqual(report.liveCoverage, false);
    assert.equal(report.liveCoverageReason, "fixture_or_owner_qa_is_not_live_production_coverage");
    assert.equal(report.journalCutCoverage, "partial");
    assert.equal(report.planeCoverage.settlements.coverage, "unknown");
    assert.equal(report.cohort, "owner_qa");
    assert.equal(report.customer, null);
    assert.equal(report.globalAgentId, null);
    assert.equal(report.database, null);
    assert.equal(report.signer, null);
    assert.equal(report.paymentPermitted, false);
    assert.equal(report.recognizedRevenueAtomic, "unknown");
    assert.equal(report.stageCounts, null);
    assert.equal(report.mintedGrant, false);
    assert.equal(report.publicSeam.paidSuccess.disposition, "unresolved");
    assert.equal(report.publicSeam.paidSuccess.observed, null);
    assert.equal(report.attemptOf, null);

    const missing = await readPersistedAttempt({ dataDir, internalToken: TOKEN, taskRef: ABSENT, baseline });
    assert.equal(missing.decision, "unresolved");
    assert.equal(missing.stages.delivery.observed, "unknown");
    assert.notEqual(missing.stages.delivery.observed, 0);
    assert.equal(missing.stageCounts, null);
    assert.equal(missing.liveCoverage, "unresolved");

    await assert.rejects(
      () => readPersistedAttempt({
        dataDir,
        internalToken: TOKEN,
        taskRef: observed.request.taskRef,
        baseline,
        link: {
          taskRef: observed.request.taskRef,
          commerceEventId: "00000000-0000-4000-8000-000000000099",
          operationId: observed.request.operationId,
        },
      }),
      (error) => error.code === "counterfeit_link",
    );
    return { dataDir, request: observed.request, responseDigest: observed.result.observation.responseDigest };
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a restarted process reads the same attempt and refuses payment replay", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "attempt-useful-restart-"));
  const app = await boot(dataDir);
  let request;
  try {
    const observed = await nodePort("caller.mjs", {
      base: app.base,
      token: TOKEN,
      hash: feeHash,
      label: "sol421-fee-restart",
    });
    assert.equal(observed.result.accepted, true, JSON.stringify(observed.result));
    request = observed.request;
    await app.capture.capture();
  } finally {
    await app.close();
  }
  try {
    const reconciled = await forkWorker({
      action: "reconcile",
      dataDir,
      internalToken: TOKEN,
      request,
    });
    assert.equal(reconciled.error, undefined, reconciled.stack);
    assert.equal(reconciled.value.reason, "duplicate");
    assert.equal(reconciled.value.grantReturned, false);
    assert.equal(reconciled.value.physicalRows, 1);
    assert.equal(reconciled.value.automaticMutationRetries, 0);
    assert.equal(reconciled.value.paymentPermitted, false);
    assert.equal(reconciled.value.recognizedRevenueAtomic, "unknown");

    const read = await forkWorker({
      action: "read",
      internalToken: TOKEN,
      dataDir,
      taskRef: request.taskRef,
      baseline,
      link: {
        taskRef: request.taskRef,
        commerceEventId: request.commerceEventId,
        operationId: request.operationId,
      },
    });
    assert.equal(read.error, undefined, read.stack);
    assert.equal(read.value.decision, "one_attempt");
    assert.equal(read.value.commerceEventId, request.commerceEventId);
    assert.equal(read.value.taskRef, request.taskRef);
    assert.equal(read.value.stages.attempt.disposition, "producer-observed");
    assert.equal(read.value.stages.delivery.disposition, "producer-observed");
    assert.equal(read.value.stageWords.settlement, "unknown");
    assert.equal(read.value.liveCoverage, "unresolved");
    assert.equal(read.value.mintedGrant, false);
    assert.equal(read.value.paymentPermitted, false);

    const replay = await forkWorker({
      action: "read",
      internalToken: TOKEN,
      dataDir,
      taskRef: request.taskRef,
      paymentReplay: true,
    });
    assert.equal(replay.error, "payment_replay_refused");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a lost acknowledgement stays one physical row and does not replay payment", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "attempt-useful-lost-"));
  const app = await boot(dataDir, { fault: "lost_ack" });
  let request;
  try {
    const observed = await nodePort("caller.mjs", {
      base: app.base,
      token: TOKEN,
      hash: feeHash,
      label: "sol421-fee-lost",
    });
    assert.equal(observed.result.accepted, false);
    assert.equal(observed.result.reason, "duplicate");
    assert.equal(observed.result.grant, null);
    assert.equal(observed.result.paymentPermitted, false);
    request = observed.request;
    await app.capture.capture();
  } finally {
    await app.close();
  }
  try {
    const reconciled = await forkWorker({
      action: "reconcile",
      dataDir,
      internalToken: TOKEN,
      request,
    });
    assert.equal(reconciled.error, undefined, reconciled.stack);
    assert.equal(reconciled.value.reason, "duplicate");
    assert.equal(reconciled.value.physicalRows, 1);
    assert.equal(reconciled.value.grantReturned, false);
    assert.equal(reconciled.value.automaticMutationRetries, 0);
    assert.equal(reconciled.value.paymentPermitted, false);
    const read = await forkWorker({
      action: "read",
      internalToken: TOKEN,
      dataDir,
      taskRef: request.taskRef,
      baseline,
    });
    assert.equal(read.error, undefined, read.stack);
    assert.equal(read.value.commerceEventId, request.commerceEventId);
    assert.equal(read.value.taskRef, request.taskRef);
    assert.equal(read.value.liveCoverage, "unresolved");
    assert.equal(read.value.stages.settlement.observed, "unknown");
    assert.equal(read.value.stageCounts, null);
    assert.equal(read.value.paymentPermitted, false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the mount refuses a new database and the executable delta matches the artifact", async () => {
  const refused = merchant161ObservationMount({
    database: "postgres://merchant/new",
    dataDir: "/tmp/attempt-useful-unused",
    internalToken: TOKEN,
    app: { use() {} },
    telemetry: { causalCommerceEventProof() {} },
  });
  assert.equal(refused.enrolled, false);
  assert.equal(refused.reason, "unsupported_authority_field");
  const url = merchant161ObservationMount({
    dataDir: "postgres://merchant/new",
    internalToken: TOKEN,
    app: { use() {} },
    telemetry: { causalCommerceEventProof() {} },
  });
  assert.equal(url.enrolled, false);
  assert.equal(url.reason, "persistence_refused");
  const missingToken = merchant161ObservationMount({
    dataDir: "/tmp/attempt-useful-unused",
    internalToken: "",
    app: { use() {} },
    telemetry: { causalCommerceEventProof() {} },
  });
  assert.equal(missingToken.enrolled, false);
  assert.equal(missingToken.reason, "existing_token_required");

  const server = readFileSync(fileURLToPath(new URL("../../../../server.js", import.meta.url)), "utf8");
  assert.match(server, /merchant161ObservationMount/);
  assert.match(server, /paymentMiddleware\(/);
  assert.equal(server.includes("skip payment for free observation"), false);
  const sellerDiff = execFileSync("git", [
    "diff",
    "--name-only",
    "32f07a836fb28e400d56b0e2e876043644bde31a",
    "--",
    "experiments/seller-repair-service-100266",
    "public-acquisition/receiving/artifact.json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(sellerDiff, "");

  const delta = integrationDeltaState();
  assert.equal(delta.status, "applied");
  assert.equal(delta.liveCoverage, "unresolved");
  assert.equal(delta.paidSuccess, "unresolved");
  assert.equal(delta.publicAcquisitionReadback.paidSuccessField, "absent");
  assert.equal(delta.publicAcquisitionReadback.paidLaunch, false);
  assert.equal(delta.serverPublished, false);
  assert.equal(delta.observationMountOnReleasedHead, false);
  assert.equal(delta.releasedMerchantHead, "32f07a836fb28e400d56b0e2e876043644bde31a");
  assert.equal(delta.publicAcquisitionArtifact, "4b7928f315be9d9ec7d14f2604eab1b7b236a63a");
  assert.equal(delta.measurementSource, "4e49c4db58ea0f5897240781fd14d80566bbabd0");
  assert.equal(delta.adaptHead, "e687ca11c2e05e8ac41ede83dc1b98cfe46c3a7c");

  const probe = spawnSync(process.execPath, [
    fileURLToPath(new URL("../bin/merchant161-delta.mjs", import.meta.url)),
    "check",
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ATTEMPT_USEFUL_PIN_PROBE: "wrong-merchant" },
  });
  assert.equal(probe.status, 2);
  assert.equal(JSON.parse(probe.stderr).reason, "merchant_pin_rejected");
});
