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

test("cli --seeded-failure rejects the sepolia-as-base lie (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "wrong_network_accepted");
  assert.equal(report.id, "seeded-wrong-network-accepted");
  assert.equal(report.settleCount, 1);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=wrong_network_accepted/);
});

test("cli fixture path rejects seeded-wrong-network-settle (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-wrong-network-settle.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "wrong_network_settle");
});

test("cli fixture path rejects seeded-wrong-network-verify (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-wrong-network-verify.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "wrong_network_verify");
});

test("runSeededFailure matches the CLI reject", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.code, "wrong_network_accepted");
  assert.equal(report.settleCount, 1);
});

test(
  "cli --cold exits 0 against loopback server.js and rejects wrong-network payloads",
  { timeout: 120_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report.failed, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "server.js");
    assert.equal(report.code, "wrong-network-holds");
    assert.equal(report.counted, 2);
    assert.deepEqual(report.settleCounts, [0, 1]);
    assert.equal(report.paymentSent, false);
    assert.equal(report.offeredNetwork, "eip155:8453");
    assert.match(result.stderr, /wrong-network cold: pass/);
    const byId = Object.fromEntries(report.scenarios.map((row) => [row.id, row]));
    const matrix = byId["x402-wrong-network-matrix"];
    assert.equal(matrix.mismatchAccepted, 0);
    assert.ok(matrix.mismatchAttempts >= 5);
    assert.equal(matrix.settleCount, 0);
    assert.equal(matrix.verifyCount, 0);
    const sepolia = matrix.attempts.find((attempt) => attempt.phase === "wrong-network-sepolia");
    assert.equal(sepolia.httpStatus, 402);
    assert.equal(sepolia.payloadNetwork, "eip155:84532");
    assert.equal(sepolia.settleDelta, 0);
    assert.equal(sepolia.verifyDelta, 0);
    assert.equal(sepolia.hasPaymentResponse, false);
    const matching = byId["x402-matching-network-control"];
    assert.equal(matching.settleCount, 1);
    const paid = matching.attempts.find((attempt) => attempt.phase === "matching");
    assert.equal(paid.httpStatus, 200);
    assert.equal(paid.payloadNetwork, "eip155:8453");
  },
);
