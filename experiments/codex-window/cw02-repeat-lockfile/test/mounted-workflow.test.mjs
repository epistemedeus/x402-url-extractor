import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "../../../../examples/customer-x402/node_modules/viem/_esm/accounts/index.js";

import { approvalTemplate, BinderRefusal, executeJob, prepareJob } from "../src/binder.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "../../..");
const JOB = join(ROOT, "examples/npm-change.job.json");
const NETWORK = "eip155:8453";

function unusedPort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
    server.once("error", reject);
  });
}

async function startFacilitator(payer) {
  const calls = { settle: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/supported") return send({ kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    if (req.url === "/verify") { calls.verify += 1; return send({ isValid: true, payer }); }
    if (req.url === "/settle") { calls.settle += 1; return send({ success: true, payer, transaction: `0x${"3".repeat(64)}`, network: NETWORK }); }
    res.writeHead(404).end();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return {
    calls,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => {
      server.closeAllConnections();
      server.close(done);
    }),
  };
}

async function startMerchant(facilitatorUrl, dataDir) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port), NETWORK, PAY_TO: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee", COMMERCE_DATA_DIR: dataDir, COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000", FACILITATOR: "xpay", FACILITATOR_URL: facilitatorUrl, MPP_SECRET_KEY: "test-secret-key-test-secret-key-32", LOCKFILE_PIN_DELTA_ENABLED: "1", EXTRACT_BATCH_ENABLED: "0", PUBLIC_URL: "https://agents.samedaydesk.com" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`merchant startup timeout: ${output}`)), 20_000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(`x402-merchant listening on :${port}`)) { clearTimeout(timer); resolveReady(); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => reject(new Error(`merchant exited ${code}: ${output}`)));
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stopChild(child) {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    const timer = setTimeout(() => { child.kill("SIGKILL"); done(); }, 2_000);
    child.once("exit", () => { clearTimeout(timer); done(); });
  });
}

async function approvedFixture(jobPath, stateDir) {
  const prepared = prepareJob({ jobPath, stateDir });
  const approval = { ...approvalTemplate(prepared.intent), permissionToSign: true, approvedAt: "2026-09-12T00:00:00Z", approvedBy: "mounted-fixture-operator" };
  const path = join(stateDir, "approval.json");
  await writeFile(path, `${JSON.stringify(approval, null, 2)}\n`);
  return { prepared, path };
}

test("actual maintained CLI: response loss keeps one resume identity; no-change is valid informational", { timeout: 120_000 }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "cw02-mounted-"));
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const facilitator = await startFacilitator(account.address);
  let merchant;
  t.after(async () => { await stopChild(merchant?.child); await facilitator.close(); await rm(scratch, { recursive: true, force: true }); });
  merchant = await startMerchant(facilitator.url, join(scratch, "merchant"));
  const mountedImport = pathToFileURL(join(ROOT, "test/mounted-fetch.mjs")).href;

  const changedState = join(scratch, "changed-state");
  const changed = await approvedFixture(JOB, changedState);
  const childEnv = { ...process.env, CW02_TEST_KEY: key, CW02_MOUNT_BASE: merchant.base, CW02_DROP_PAID_RESPONSE: "1", NODE_OPTIONS: `--import=${mountedImport}` };
  const lost = await executeJob({ jobPath: JOB, stateDir: changedState, approvalPath: changed.path, approve: true, privateKeyEnv: "CW02_TEST_KEY", env: childEnv });
  assert.equal(lost.code, 2);
  assert.equal(lost.phase, "resume_required");
  assert.equal(lost.intent.intentId, changed.prepared.intent.intentId);
  assert.equal(lost.intent.resumeId, changed.prepared.intent.resumeId);
  assert.equal(facilitator.calls.settle, 1);
  await assert.rejects(() => executeJob({ jobPath: JOB, stateDir: changedState, approvalPath: changed.path, approve: true, privateKeyEnv: "CW02_TEST_KEY", env: childEnv }), (error) => error instanceof BinderRefusal && error.code === "resume_required" && error.detail.resumeId === changed.prepared.intent.resumeId);
  assert.equal(facilitator.calls.settle, 1);

  const noChangeJob = JSON.parse(await readFile(JOB, "utf8"));
  noChangeJob.jobId = "cw02-mounted-no-change";
  noChangeJob.inputs.current = noChangeJob.inputs.previous;
  const noChangePath = join(ROOT, "examples/.mounted-no-change.test.json");
  await writeFile(noChangePath, `${JSON.stringify(noChangeJob)}\n`);
  try {
    const noChangeState = join(scratch, "no-change-state");
    const noChange = await approvedFixture(noChangePath, noChangeState);
    assert.equal(noChange.prepared.intent.analysis, "informational");
    const delivered = await executeJob({ jobPath: noChangePath, stateDir: noChangeState, approvalPath: noChange.path, approve: true, privateKeyEnv: "CW02_TEST_KEY", env: { ...childEnv, CW02_DROP_PAID_RESPONSE: "0" } });
    assert.equal(delivered.code, 0, `${delivered.stdout}\n${delivered.stderr}`);
    assert.equal(delivered.payload.outcome, "valid_delivered");
    assert.equal(delivered.payload.evidence.retainedBody.analysis, "informational");
    assert.equal(facilitator.calls.settle, 2);
  } finally {
    await rm(noChangePath, { force: true });
  }
});
