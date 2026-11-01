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

import { approvalTemplate, BinderRefusal, executeJob as runBinder, prepareJob } from "../src/binder.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.CW35_MERCHANT_ROOT ? resolve(process.env.CW35_MERCHANT_ROOT) : resolve(ROOT, "../../..");
const CUSTOMER_CLI = join(REPO, "examples/customer-x402/bin/cli.mjs");
const executeJob = (options) => runBinder({ customerCli: CUSTOMER_CLI, ...options });
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

async function startMerchant(facilitatorUrl, dataDir, enabled = "1") {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port), NETWORK, PAY_TO: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee", COMMERCE_DATA_DIR: dataDir, COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000", FACILITATOR: "xpay", FACILITATOR_URL: facilitatorUrl, MPP_SECRET_KEY: "test-secret-key-test-secret-key-32", LOCKFILE_PIN_DELTA_ENABLED: enabled, VENDOR_BUDGET_IMPACT_ENABLED: "0", EXTRACT_BATCH_ENABLED: "0", PUBLIC_URL: "https://agents.samedaydesk.com" },
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

test("mounted maintained CLI: approval binding, single flight, partial and adversarial paid output", { timeout: 120_000 }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "cw35-mounted-"));
  const key = generatePrivateKey(), account = privateKeyToAccount(key);
  const facilitator = await startFacilitator(account.address);
  let merchant;
  t.after(async () => { await stopChild(merchant?.child); await facilitator.close(); await rm(scratch, { recursive: true, force: true }); });
  merchant = await startMerchant(facilitator.url, join(scratch, "merchant"));
  const mountedImport = pathToFileURL(join(ROOT, "test/mounted-fetch.mjs")).href;
  const childEnv = { ...process.env, CW02_TEST_KEY: key, CW02_MOUNT_BASE: merchant.base, CW02_DROP_PAID_RESPONSE: "0", NODE_OPTIONS: `--import=${mountedImport}` };
  let index = 0;
  async function fixture(mutate = () => {}) {
    const dir = join(scratch, `case-${++index}`);
    const original = JSON.parse(await readFile(JOB, "utf8"));
    original.inputs = Object.fromEntries(Object.entries(original.inputs).map(([k, p]) => [k, resolve(dirname(JOB), p)]));
    await mutate(original, dir);
    const jobPath = join(scratch, `job-${index}.json`);
    await writeFile(jobPath, JSON.stringify(original));
    const approved = await approvedFixture(jobPath, dir);
    return { dir, jobPath, approved, run: (env = {}) => executeJob({ jobPath, stateDir: dir, approvalPath: approved.path, approve: true, privateKeyEnv: "CW02_TEST_KEY", customerCli: CUSTOMER_CLI, env: { ...childEnv, ...env } }) };
  }
  await t.test("unchanged approved body produces actionable pin evidence", async () => {
    const f = await fixture(), count = facilitator.calls.settle;
    const result = await f.run();
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.payload.binderValidation, "matched-approved-pin-evidence");
    assert.equal(result.payload.evidence.retainedBody.engine.changed[0].after.version, "7.0.0");
    assert.equal(facilitator.calls.settle, count + 1);
  });
  await t.test("membership changes validate full added and removed pin rows", async () => {
    const f = await fixture(async (job) => {
      const doc = JSON.parse(await readFile(job.inputs.current, "utf8"));
      const pin = doc.packages["node_modules/is-number"];
      delete doc.packages["node_modules/is-number"];
      doc.packages["node_modules/added-package"] = { ...pin, name: "added-package" };
      const path = join(scratch, "membership.json"); await writeFile(path, JSON.stringify(doc)); job.inputs.current = path;
    });
    const result = await f.run();
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.payload.evidence.retainedBody.engine.added.length, 1);
    assert.equal(result.payload.evidence.retainedBody.engine.removed.length, 1);
  });
  await t.test("legacy nested dependency maps preserve normalized meaning", async () => {
    const f = await fixture(async (job) => {
      const before = { lockfileVersion: 2, dependencies: { lib: { version: 1, integrity: " sha512-lib ", resolved: "https://registry.example/lib", dependencies: { child: { version: "1", integrity: "sha512-child" } } } } };
      const after = structuredClone(before); after.dependencies.lib.dependencies.child.version = "2";
      for (const [role, doc] of [["previous", before], ["current", after]]) {
        const path = join(scratch, `nested-${role}.json`); await writeFile(path, JSON.stringify(doc)); job.inputs[role] = path;
      }
    });
    const result = await f.run();
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.payload.evidence.retainedBody.engine.changed[0].id, "node_modules/lib/node_modules/child");
  });
  for (const mode of ["foreign", "truncated", "wrong-pin", "wrong-digest", "quote"]) {
    await t.test(`rejects ${mode} paid response without losing original attempt`, async () => {
      const f = await fixture(), count = facilitator.calls.settle;
      const result = await f.run({ CW35_PAID_MUTATION: mode });
      assert.equal(result.code, 2, result.stdout + result.stderr);
      assert.equal(result.payload.outcome, "paid_invalid_output");
      assert.equal(result.phase, "resume_required");
      assert.equal(JSON.parse(result.stdout).outcome, "paid_invalid_output");
      assert.equal(facilitator.calls.settle, count + 1);
      await assert.rejects(f.run(), (e) => e.code === "resume_required");
      assert.equal(facilitator.calls.settle, count + 1);
    });
  }
  for (const mode of ["price", "recipient", "route"]) {
    await t.test(`refuses foreign ${mode} challenge before facilitator verification`, async () => {
      const f = await fixture(), count = { ...facilitator.calls };
      const result = await f.run({ CW35_CHALLENGE_MUTATION: mode });
      assert.equal(result.code, 2, result.stdout + result.stderr);
      assert.notEqual(result.payload?.outcome, "valid_delivered");
      assert.deepEqual(facilitator.calls, count);
    });
  }
  await t.test("same-intent concurrent execution signs and settles at most once", async () => {
    const f = await fixture(), count = facilitator.calls.settle;
    const results = await Promise.allSettled([f.run(), f.run(), f.run()]);
    assert.equal(results.filter((r) => r.status === "fulfilled" && r.value.code === 0).length, 1);
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(rejected.length, 2);
    assert.ok(rejected.every((r) => r.reason.code === "resume_required"));
    assert.equal(facilitator.calls.settle, count + 1);
  });
  await t.test("missing integrity remains delivered partial, never full fulfillment", async () => {
    const f = await fixture(async (job) => {
      const doc = JSON.parse(await readFile(job.inputs.current, "utf8"));
      delete doc.packages["node_modules/is-number"].integrity;
      const path = join(scratch, "partial.json"); await writeFile(path, JSON.stringify(doc)); job.inputs.current = path;
    });
    const result = await f.run();
    assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.equal(result.payload.outcome, "partial_delivered");
    assert.equal(result.phase, "response_observed");
    await assert.rejects(f.run(), (e) => e.code === "resume_required");
  });
  await t.test("separate binder processes share one signing owner", async () => {
    const f = await fixture(), count = facilitator.calls.settle;
    const run = () => new Promise((done, reject) => {
      const child = spawn(process.execPath, [join(ROOT, "bin/repeat-lockfile.mjs"), "run", "--job", f.jobPath, "--state-dir", f.dir, "--approval", f.approved.path, "--approve", "--private-key-env", "CW02_TEST_KEY", "--customer-cli", CUSTOMER_CLI], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; child.stdout.on("data", (c) => { output += c; }); child.stderr.on("data", (c) => { output += c; });
      child.once("error", reject); child.once("close", (code) => done({ code, output }));
    });
    const results = await Promise.all([run(), run(), run()]);
    assert.equal(results.filter((r) => r.code === 0).length, 1, JSON.stringify(results));
    assert.equal(results.filter((r) => r.code === 2 && r.output.includes("resume_required")).length, 2);
    assert.equal(facilitator.calls.settle, count + 1);
  });
  await t.test("flag-off mounted route creates no payment or signing identity", async () => {
    const f = await fixture(), count = { ...facilitator.calls };
    const off = await startMerchant(facilitator.url, join(scratch, "flag-off"), "0");
    try {
      const result = await f.run({ CW02_MOUNT_BASE: off.base });
      assert.equal(result.code, 2, result.stdout + result.stderr);
      assert.equal(result.phase, "failed_before_identity");
      assert.deepEqual(facilitator.calls, count);
    } finally { await stopChild(off.child); }
  });
  await t.test("changed approved body is refused before signing", async () => {
    const f = await fixture(), count = { ...facilitator.calls };
    const job = JSON.parse(await readFile(f.jobPath, "utf8"));
    job.inputs.current = job.inputs.previous; await writeFile(f.jobPath, JSON.stringify(job));
    await assert.rejects(f.run(), (e) => ["request_changed", "approval_stale"].includes(e.code));
    assert.deepEqual(facilitator.calls, count);
  });
});
