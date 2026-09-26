import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { CHECK, GUARD_ROOT } from "./paths.mjs";
import { runSeededFailure } from "./run.mjs";

function runCheck(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHECK, ...args], {
      cwd: GUARD_ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out: ${args.join(" ")}\n${stderr}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function parseReport(stdout) {
  const text = stdout.trim();
  assert.ok(text.startsWith("{"), `expected JSON report, got: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

test("cli help exits 0", async () => {
  const result = await runCheck(["help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--seeded-failure/);
  assert.match(result.stdout, /--cold/);
  assert.match(result.stdout, /Never pays/);
});

test("cli refuses --live --pay --neo --publish", async () => {
  for (const flag of ["--live", "--pay", "--payment", "--neo", "--publish"]) {
    const result = await runCheck([flag]);
    assert.equal(result.code, 2, flag);
    const report = parseReport(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.code, "usage");
    assert.match(report.error, /refused/);
  }
});

test("cli --all-fixtures classifies pass and reject traces", async () => {
  const result = await runCheck(["--all-fixtures"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.ok, true);
  assert.equal(report.counted, 7);
});

test("cli --seeded-failure rejects the wrong-asset settle lie (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "wrong_asset_settled");
  assert.equal(report.id, "seeded-wrong-asset-settled");
  assert.equal(report.settleCount, 1);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=wrong_asset_settled/);
});

test("cli fixture path rejects seeded-eip712-domain-settled (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-eip712-domain-settled.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((item) => item.code === "wrong_asset_settled"));
});

test("runSeededFailure matches the CLI reject", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.code, "wrong_asset_settled");
  assert.equal(report.settleCount, 1);
});

test(
  "cli --cold exits 0 against loopback server.js and never settles wrong-asset",
  { timeout: 120_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report.failed, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "server.js");
    assert.equal(report.code, "guard-holds");
    assert.equal(report.counted, 5);
    assert.deepEqual(report.settleCounts, [1, 0, 0, 0, 0]);
    assert.equal(report.paymentSent, false);
    assert.equal(report.boundary.liveFacilitator, false);
    assert.equal(report.boundary.neoTouched, false);
    assert.match(result.stderr, /wrong-asset cold: pass/);
    const byId = Object.fromEntries(report.scenarios.map((row) => [row.id, row]));
    const control = byId["x402-canonical-usdc-settles"];
    assert.equal(control.kind, "canonical-control");
    assert.equal(control.settleCount, 1);
    assert.equal(control.asset.wrong, false);
    const paid = control.attempts.find((attempt) => attempt.phase === "paid");
    assert.equal(paid.httpStatus, 200);
    assert.equal(paid.hasPaymentResponse, true);
    assert.equal(paid.verifyDelta, 1);

    for (const id of [
      "x402-wrong-erc20-never-settles",
      "x402-sepolia-usdc-never-settles",
      "x402-native-eth-never-settles",
      "x402-wrong-eip712-name-never-settles",
    ]) {
      const row = byId[id];
      assert.ok(row, id);
      assert.equal(row.settleCount, 0, id);
      assert.equal(row.verifyCount, 0, id);
      assert.equal(row.asset.wrong, true, id);
      const attempt = row.attempts.find((item) => item.phase === "paid");
      assert.notEqual(attempt.httpStatus, 200, id);
      assert.equal(attempt.hasPaymentResponse, false, id);
      assert.equal(attempt.settleDelta, 0, id);
      assert.equal(attempt.verifyDelta, 0, id);
    }
  },
);
