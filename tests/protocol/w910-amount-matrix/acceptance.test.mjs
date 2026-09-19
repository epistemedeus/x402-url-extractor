import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { CODES } from "./constants.mjs";
import { CHECK, ROOT } from "./paths.mjs";
import { runSeededFailure } from "./run.mjs";

function runCheck(args, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHECK, ...args], {
      cwd: ROOT,
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

test("cli --all-fixtures classifies pass and reject observations", async () => {
  const result = await runCheck(["--all-fixtures"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 15);
});

test("cli --seeded-failure rejects scan amount 5000 as not pin 200000 (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.AMOUNT_MISMATCH);
  assert.equal(report.id, "seeded-amount-mismatch");
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=amount_mismatch/);
});

test("cli fixture path rejects numeric 5000 (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-numeric-amount.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.AMOUNT_NOT_STRING);
});

test("cli fixture path rejects HTTP 402 as settlement (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-402-as-settlement.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.HTTP_402_CLASSIFIED_AS_SETTLEMENT);
});

test("cli fixture path rejects absence as demand (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-absence-as-demand.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ABSENCE_AS_DEMAND);
});

test("cli refuses --live / --cdp / --pay / --neo (exit 2)", async () => {
  for (const flag of ["--live", "--cdp", "--pay", "--neo"]) {
    const result = await runCheck([flag]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(report.ok, false);
    assert.equal(report.code, "refused");
  }
});

test("runSeededFailure matches the CLI reject", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.AMOUNT_MISMATCH);
  assert.equal(report.classified.httpAmount.value, "5000");
});

test(
  "cli --cold exits 0 against mounted server.js unpaid 402 amount matrix",
  { timeout: 90_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "server.js");
    assert.equal(report.code, CODES.UNPAID_AMOUNT_MATRIX);
    assert.equal(report.paymentSent, false);
    assert.equal(report.paymentSignatureSent, false);
    assert.equal(report.routes.extract.http, "5000");
    assert.equal(report.routes.extract.mcp, "5000");
    assert.equal(report.routes.extract.openapi, "$0.005");
    assert.equal(report.routes.scan.http, "200000");
    assert.equal(report.routes.scan.mcp, "200000");
    assert.equal(report.routes.scan.openapi, "$0.20");
    assert.equal(report.routes.transaction_receipt.http, "2000");
    assert.equal(report.routes.transaction_receipt.mcp, "2000");
    assert.equal(report.routes.transaction_receipt.openapi, "$0.002");
    assert.equal(report.wire.http.extract.status, 402);
    assert.equal(report.wire.http.scan.status, 402);
    assert.equal(report.wire.http.transaction_receipt.status, 402);
    assert.equal(report.wire.toolsListHttpStatus, 200);
    assert.equal(report.counters.verify, 0);
    assert.equal(report.counters.settle, 0);
    assert.match(result.stderr, /w910-amount-matrix cold: pass/);
  },
);
