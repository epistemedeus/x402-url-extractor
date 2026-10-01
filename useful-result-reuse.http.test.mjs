import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "loopback-useful-result-grant-token-32bytes-min";

function run(args, env) {
  return spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
}

test("clean loopback caller retrieves a scoped result and leaves paid routes unpaid", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "useful-reuse-http-"));
  const tokenFile = path.join(dataDir, "token");
  const outcomeFile = path.join(dataDir, "outcome.json");
  await writeFile(tokenFile, TOKEN);
  await writeFile(outcomeFile, JSON.stringify({
    schema: "samedaydesk.useful-result.v1",
    schemaVersion: "1",
    availability: "present",
    disposition: "useful",
    code: "unpaid_receipt_readable",
    httpStatus: 200,
    usefulDelivery: "true",
  }));
  const bound = run([
    "useful-result-reuse/cli.mjs", "bind",
    "--data", dataDir,
    "--token-file", tokenFile,
    "--task", "caller-unpaid-receipt",
    "--operation", "read-unpaid-receipt",
    "--method", "GET",
    "--route", "/read",
    "--schema", "samedaydesk.useful-result.v1",
    "--schema-version", "1",
    "--class", "owner",
    "--outcome-file", outcomeFile,
    "--asserted-digest", "ab".repeat(32),
  ]);
  assert.equal(bound.status, 0, bound.stderr);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "39114",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_INTERNAL_TOKEN: TOKEN,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output.slice(-2000))), 20000);
      const onData = (chunk) => {
        output += chunk;
        if (output.includes("x402-merchant listening on :39114")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited ${code}: ${output.slice(-2000)}`));
      });
    });
    const caller = run(["useful-result-reuse/cold-caller.mjs"], {
      USEFUL_RESULT_BASE: "http://127.0.0.1:39114",
      USEFUL_RESULT_TOKEN: TOKEN,
      USEFUL_RESULT_TASK: "caller-unpaid-receipt",
      USEFUL_RESULT_OPERATION: "read-unpaid-receipt",
    });
    assert.equal(caller.status, 0, `${caller.stdout}\n${caller.stderr}`);
    const receipt = JSON.parse(caller.stdout);
    assert.equal(receipt.extractStatus, 402);
    assert.equal(receipt.transactionReceiptStatus, 402);
    assert.equal(receipt.acquisitionProductionHosted, false);
    assert.equal(receipt.archiveBytes, 107420);
    assert.equal(receipt.archiveBodyBytes, 0);
    assert.equal(receipt.scopedStatus, 200);
    assert.equal(receipt.scopedUseful, "true");
    assert.equal(receipt.wrongGrantStatus, 403);
    assert.equal(receipt.independentAdoption, "unknown");
    assert.equal(receipt.leakedToken, false);
    assert.equal(receipt.leakedTaskLabel, false);
    const shared = run([
      "useful-result-reuse/cli.mjs", "share",
      "--data", dataDir,
      "--token-file", tokenFile,
      "--task", "caller-unpaid-receipt",
      "--operation", "read-unpaid-receipt",
      "--class", "owner",
    ]);
    assert.equal(shared.status, 0, shared.stderr);
    const after = await fetch("http://127.0.0.1:39114/.well-known/useful-result-reuse/current.json");
    const current = await after.json();
    assert.equal(current.schema, "samedaydesk.useful-result-reuse.current.v1");
    assert.equal(current.items.length, 1);
    assert.equal(current.items[0].derived.code, "unpaid_receipt_readable");
    assert.equal(JSON.stringify(current).includes("caller-unpaid-receipt"), false);
    assert.equal(JSON.stringify(current).includes(TOKEN), false);
    const descriptor = await fetch("http://127.0.0.1:39114/mcp").then((response) => response.json());
    assert.equal(descriptor.usefulResultReuse, "https://agents.samedaydesk.com/.well-known/useful-result-reuse/current.json");
    const sentinel = "sentinel-private-reuse-100224";
    await writeFile(path.join(dataDir, "PRIVATE_SENTINEL"), sentinel);
    const fixture = path.join(root, "useful-result-reuse/fixtures/h15-base-receipt.json");
    const verified = run([
      "useful-result-reuse/cli.mjs", "verify-settlement",
      "--data", dataDir,
      "--token-file", tokenFile,
      "--task", "owner-closed-settlement",
      "--operation", "normalized-transaction-receipt",
      "--class", "owner",
      "--receipt-file", fixture,
    ]);
    assert.equal(verified.status, 0, verified.stderr);
    const knowledge = run([
      "useful-result-reuse/cli.mjs", "share-knowledge",
      "--data", dataDir,
      "--token-file", tokenFile,
      "--task", "owner-closed-settlement",
      "--operation", "normalized-transaction-receipt",
      "--class", "owner",
    ]);
    assert.equal(knowledge.status, 0, knowledge.stderr);
    const work = await mkdtemp(path.join(tmpdir(), "useful-reuse-receiver-"));
    copyFileSync(fixture, path.join(work, "receipt.json"));
    try {
      const exercised = run(["useful-result-reuse/cold-caller.mjs"], {
        USEFUL_RESULT_BASE: "http://127.0.0.1:39114",
        USEFUL_RESULT_TOKEN: TOKEN,
        USEFUL_RESULT_TASK: "caller-unpaid-receipt",
        USEFUL_RESULT_OPERATION: "read-unpaid-receipt",
        USEFUL_RESULT_WORK: work,
        USEFUL_RESULT_RECEIPT: path.join(work, "receipt.json"),
      });
      assert.equal(exercised.status, 0, `${exercised.stdout}\n${exercised.stderr}`);
      const exercisedBody = JSON.parse(exercised.stdout);
      assert.equal(exercisedBody.extractStatus, 402);
      assert.equal(exercisedBody.transactionReceiptStatus, 402);
      assert.equal(exercisedBody.archiveBytes, 107420);
      assert.equal(exercisedBody.knowledge.knowledgeApplied, true);
      assert.equal(exercisedBody.knowledge.usefulTransferred, false);
      assert.equal(exercisedBody.knowledge.executionSaved, false);
      assert.equal(exercisedBody.knowledge.sameAccounting, true);
      assert.equal(exercisedBody.knowledge.observedSaving, false);
      assert.equal(exercisedBody.knowledge.expenseAtomic, "200000");
      assert.equal(exercisedBody.leakedToken, false);
      assert.equal(exercisedBody.leakedTaskLabel, false);
      assert.equal(exercisedBody.leakedWallet, false);
      const names = await readdir(work);
      assert.equal(names.includes("PRIVATE_SENTINEL"), false);
      assert.equal(names.includes("useful-result-private.ndjson"), false);
      const derivative = await readFile(path.join(work, "derivative.json"), "utf8");
      assert.equal(derivative.includes(sentinel), false);
      assert.equal(derivative.includes(TOKEN), false);
      assert.equal(derivative.includes("caller-unpaid-receipt"), false);
      assert.equal(derivative.includes("owner-closed-settlement"), false);
      assert.equal(/8904df3d|aef308a4/i.test(derivative), false);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  }
});
