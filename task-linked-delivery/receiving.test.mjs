import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const token = "task-linked-delivery-internal-token-32";

function run(script, args, env) {
  return spawnSync(process.execPath, [path.join(here, "bin", script), ...args], {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("two processes record a controlled delivery and reject a seeded relabel", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "task-linked-delivery-"));
  const env = {
    TASK_LINK_DATA_DIR: dataDir,
    TASK_LINK_TOKEN: token,
    HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated",
  };
  try {
    const produced = run("produce-controlled.mjs", [], env);
    assert.equal(produced.status, 0, `${produced.stdout}\n${produced.stderr}`);
    const producer = JSON.parse(produced.stdout);
    assert.equal(producer.schemaValidDelivery, true);
    assert.equal(producer.settlementAccepted, true);
    const consumed = run("consume-readout.mjs", [], env);
    assert.equal(consumed.status, 0, `${consumed.stdout}\n${consumed.stderr}`);
    const readout = JSON.parse(consumed.stdout);
    assert.equal(readout.controlledEvidenceJoin, true);
    assert.equal(readout.externalDemandProved, false);
    assert.equal(readout.independentConversion, "unknown");
    assert.equal(readout.recognizedRevenueAtomic, "0");
    assert.equal(readout.historicBankedRevenueUsdc, 10.955);
    assert.equal(readout.partialReadoutZeroIsNotHistoricRevenue, true);
    assert.equal(readout.h15SponsoredExpenseAtomic, "200000");
    assert.equal(readout.h15Claim, "closed");
    assert.equal(readout.h15InsideRecognizedRevenue, false);
    assert.equal(readout.usefulUsefulness, "unknown");
    assert.equal(readout.laterReuseJoined, "joined");
    assert.equal(readout.downloadOnly, true);
    assert.equal(readout.publicIndependentUsefulDemand, "unknown");
    assert.equal(readout.publicConversionRate, null);
    assert.equal(readout.seededRelabelExit, 2);
    assert.equal(readout.independentUse, 0);
    assert.ok(readout.unlinkedCommerceEvents > 0);
    const taskText = await readFile(path.join(dataDir, "commerce-outcome-task-ref.ndjson"), "utf8");
    assert.equal(taskText.includes("task-useful-delivery"), false);
    assert.equal(taskText.includes(token), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a second process sees a refused append and then a recovered one", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "task-linked-append-"));
  const env = { TASK_LINK_DATA_DIR: dataDir, TASK_LINK_TOKEN: token };
  try {
    const seeded = run("append-control.mjs", ["seed"], env);
    assert.equal(seeded.status, 0, seeded.stderr);
    const taskPath = path.join(dataDir, "commerce-outcome-task-ref.ndjson");
    const before = await readFile(taskPath, "utf8");
    await chmod(taskPath, 0o400);
    const failed = run("append-control.mjs", ["fail"], env);
    assert.equal(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.equal(JSON.parse(failed.stdout).reason, "write_outcome_unknown");
    assert.equal(await readFile(taskPath, "utf8"), before);
    await chmod(taskPath, 0o600);
    const retried = run("append-control.mjs", ["retry"], env);
    assert.equal(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
    const after = await readFile(taskPath, "utf8");
    assert.equal(after.startsWith(before), true);
    assert.equal(after.trim().split("\n").length, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
