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
  assert.equal(report.counted, 8);
});

test("cli --seeded-failure rejects the malformed-payto-accepted lie (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "malformed_payto_accepted");
  assert.equal(report.id, "seeded-malformed-payto-accepted");
  assert.equal(report.malformedPayToAccepted, true);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=malformed_payto_accepted/);
});

test("cli fixture path rejects seeded-empty-payto-accepted (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-empty-payto-accepted.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "malformed_payto_accepted");
});

test("cli fixture path rejects seeded-unpaid-malformed-payto (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-unpaid-malformed-payto.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "malformed_quoted_payto");
});

test("runSeededFailure matches the CLI reject", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.code, "malformed_payto_accepted");
  assert.equal(report.malformedPayToAccepted, true);
});

test(
  "cli --cold exits 0 against loopback server.js and rejects malformed payTo",
  { timeout: 120_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report.failed));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "server.js");
    assert.equal(report.counted, 4);
    assert.equal(report.malformedPayToAccepted, false);
    assert.equal(report.paymentSent, false);
    assert.equal(report.boundary.neoTouched, false);
    assert.deepEqual(report.settleCounts, [0, 0, 0, 1]);
    const malformed = report.scenarios.find((row) => row.id === "x402-malformed-to-rejected");
    assert.ok(malformed);
    assert.equal(malformed.ok, true);
    assert.equal(malformed.settleCount, 0);
    const unpaid = report.scenarios.find((row) => row.id === "x402-unpaid-wellformed-payto");
    assert.match(String(unpaid.payTo), /^0x[0-9a-fA-F]{40}$/);
  },
);
