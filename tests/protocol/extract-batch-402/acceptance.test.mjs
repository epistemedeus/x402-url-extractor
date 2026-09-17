import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { BATCH, CODES } from "./constants.mjs";
import { CHECK, SUITE_ROOT } from "./paths.mjs";
import { runSeededFailure } from "./run.mjs";

function runCheck(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHECK, ...args], {
      cwd: SUITE_ROOT,
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
  assert.match(result.stdout, /\/extract\/batch/);
});

test("cli --all-fixtures classifies pass and reject traces", async () => {
  const result = await runCheck(["--all-fixtures"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.ok, true);
  assert.equal(report.counted, 7);
});

test("cli --seeded-failure rejects GET-extract rewrite classification (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.NOT_EXTRACT_REWRITE);
  assert.equal(report.id, "seeded-get-extract-rewrite");
  assert.equal(report.claimsRejected, true);
  assert.notEqual(report.code, "unsupported_target");
  assert.notEqual(report.code, "one_paywall");
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=not_extract_rewrite/);
});

test("cli fixture path rejects amount mismatch (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-amount-mismatch.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.code, CODES.AMOUNT_MISMATCH);
});

test("cli fixture path rejects invented loyaltyPoints (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-invented-field.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.code, CODES.INVENTED_RECEIPT_FIELD);
});

test("runSeededFailure matches the CLI reject", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.NOT_EXTRACT_REWRITE);
  assert.equal(report.claims.classification, "get_extract_rewrite");
  assert.equal(report.claims.amountAtomic, "5000");
});

test(
  "cli --cold exits 0 against live unpaid POST /extract/batch amount 10000",
  { timeout: 120_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr + result.stdout.slice(0, 2000));
    assert.equal(report.ok, true, JSON.stringify({ code: report.code, violations: report.violations, quotes: report.quotes }, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.code, CODES.NATIVE);
    assert.equal(report.httpStatus, 402);
    assert.equal(report.amount, BATCH.amountAtomic);
    assert.equal(report.bazaarMethod, "POST");
    assert.equal(report.path, BATCH.path);
    assert.equal(report.method, "POST");
    assert.equal(report.rewrite, false);
    assert.equal(report.paymentSent, false);
    assert.equal(report.probe?.mcp?.extract_batch?.amount, BATCH.amountAtomic);
    assert.equal(report.probe?.wellKnown?.amount, BATCH.amountAtomic);
    assert.equal(report.probe?.wellKnown?.method, "POST");
    assert.match(report.probe?.openapi402 || "", /\$0\.01 introductory flat batch quote/);
    assert.equal(report.probe?.paymentResponseHeader, false);
    assert.match(result.stderr, /extract-batch-402 cold: pass/);
  },
);
