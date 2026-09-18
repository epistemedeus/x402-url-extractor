import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { CODES, SDS } from "./constants.mjs";
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
  assert.equal(report.counted, 9);
});

test("cli --seeded-failure rejects HTTP 200 as charged/paid delivery (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.HTTP_200_CLASSIFIED_AS_CHARGED);
  assert.equal(report.id, "seeded-http-200-as-charged");
  assert.equal(report.claims.charged, true);
  assert.equal(report.claims.paidDelivery, true);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=http_200_classified_as_charged/);
});

test("cli fixture path rejects JSON-RPC error (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-jsonrpc-error.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.JSONRPC_ERROR_NOT_ISERROR);
});

test("cli fixture path rejects omitted isError (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-iserror-omitted.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ISERROR_OMITTED);
});

test("cli fixture path rejects Payment-Required header (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-payment-required-header.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.PAYMENT_REQUIRED_HEADER);
});

test("cli fixture path rejects invented loyaltyPoints (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-invented-field.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.INVENTED_RECEIPT_FIELD);
});

test("cli fixture path rejects extract amount 200000 (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-amount-mismatch.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.AMOUNT_MISMATCH);
});

test("cli refuses --live / --cdp / --pay (exit 2)", async () => {
  for (const flag of ["--live", "--cdp", "--pay"]) {
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
  assert.equal(report.code, CODES.HTTP_200_CLASSIFIED_AS_CHARGED);
  assert.equal(report.classified.charged, false);
});

test(
  "cli --cold exits 0 against mounted mcp-server.mjs unpaid tools/call HTTP 200 isError",
  { timeout: 90_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "mcp-server.mjs");
    assert.equal(report.code, CODES.UNPAID_MCP_CHALLENGE);
    assert.equal(report.paymentSent, false);
    assert.equal(report.paymentSignatureSent, false);
    assert.equal(report.wire.toolsListHttpStatus, 200);
    assert.equal(report.wire.toolsCallHttpStatus, 200);
    assert.equal(report.wire.toolsCallIsError, true);
    assert.equal(report.wire.toolsCallHasJsonRpcError, false);
    assert.equal(report.wire.paymentRequiredHeader, false);
    assert.equal(report.toolsList.classified.paymentRequired, true);
    assert.equal(report.toolsList.classified.amount, SDS.amountAtomic);
    assert.equal(report.toolsCall.classified.kind, "unpaid_mcp_challenge");
    assert.equal(report.toolsCall.classified.isError, true);
    assert.equal(report.toolsCall.classified.charged, false);
    assert.equal(report.toolsCall.classified.resourceUrl, SDS.mcpResourceUrl);
    assert.equal(report.toolsCall.classified.amount, SDS.amountAtomic);
    assert.equal(report.toolsCall.classified.payTo, SDS.payTo);
    assert.match(String(report.toolsCall.classified.error), /Payment required to access this tool/);
    assert.equal(report.counters.handler, 0);
    assert.equal(report.counters.verify, 0);
    assert.equal(report.counters.settle, 0);
    assert.ok(!report.wire.headerNames.includes("payment-required"));
    assert.match(result.stderr, /w929-mcp-iserror cold: pass/);
  },
);
