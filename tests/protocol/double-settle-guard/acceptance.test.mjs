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
});

test("cli --all-fixtures classifies pass and reject traces", async () => {
  const result = await runCheck(["--all-fixtures"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.ok, true);
  assert.equal(report.counted, 5);
});

test("cli --seeded-failure rejects the double-settle lie (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "double_settle");
  assert.equal(report.id, "seeded-double-settle");
  assert.equal(report.settleCount, 2);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=double_settle/);
});

test("cli fixture path rejects seeded-unknown-retry-settle (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-unknown-retry-settle.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((item) => item.code === "unknown_retry_settle"));
});

test("cli fixture path rejects seeded-replay-resettle (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-replay-resettle.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "replay_resettle");
});

test("runSeededFailure matches the CLI reject", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.code, "double_settle");
  assert.equal(report.settleCount, 2);
});

test(
  "cli --cold exits 0 against loopback server.js and never double-settles",
  { timeout: 120_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report.failed, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "server.js");
    assert.equal(report.code, "guard-holds");
    assert.equal(report.counted, 3);
    assert.deepEqual(report.settleCounts, [1, 1, 1]);
    assert.equal(report.paymentSent, false);
    assert.match(result.stderr, /double-settle-guard cold: pass/);
    const byId = Object.fromEntries(report.scenarios.map((row) => [row.id, row]));
    const retry = byId["x402-success-replay-restart"].attempts.find((attempt) => attempt.phase === "retry");
    const resumed = byId["x402-success-replay-restart"].attempts.find((attempt) => attempt.phase === "restart-retry");
    assert.equal(retry.replay, "hit");
    assert.equal(retry.settleDelta, 0);
    assert.equal(resumed.replay, "hit");
    assert.equal(resumed.settleDelta, 0);
    const unknownRetry = byId["x402-unknown-quarantine-restart"].attempts.find((attempt) => attempt.phase === "retry");
    assert.equal(unknownRetry.httpStatus, 503);
    assert.equal(unknownRetry.newSettlementAttempt, false);
    assert.equal(unknownRetry.settleDelta, 0);
    assert.equal(byId["x402-concurrent-twin"].settleCount, 1);
  },
);
