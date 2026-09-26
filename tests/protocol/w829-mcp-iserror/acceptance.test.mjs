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

test("cli --seeded-failure rejects HTTP 200 isError as charged/paid delivery (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED);
  assert.equal(report.id, "seeded-http-200-iserror-as-charged");
  assert.equal(report.claims.charged, true);
  assert.equal(report.claims.paidDelivery, true);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=http_200_iserror_classified_as_charged/);
});

test("cli fixture path rejects isError:false (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-iserror-false.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ISERROR_NOT_TRUE);
});

test("cli fixture path rejects JSON-RPC -32042 (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-jsonrpc-error-32042.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.JSONRPC_ERROR_NOT_ISERROR);
});

test("cli fixture path rejects HTTP 402 (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-http-402.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.HTTP_402_NOT_MCP_ISERROR);
});

test("cli fixture path rejects snake_case is_error (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-snake-is_error.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.SNAKE_IS_ERROR);
});

test("cli fixture path rejects isError mixed with delivery (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-iserror-with-delivery.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ISERROR_MIXED_WITH_DELIVERY);
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
  assert.equal(report.code, CODES.HTTP_200_ISERROR_CLASSIFIED_AS_CHARGED);
  assert.equal(report.classified.charged, false);
});

test(
  "cli --cold exits 0 against mcp-server.mjs and loopback server.js unpaid tools/call HTTP 200 isError",
  { timeout: 180_000 },
  async () => {
    const result = await runCheck(["--cold"], { timeoutMs: 180_000 });
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "mcp-server.mjs+server.js");
    assert.equal(report.code, CODES.UNPAID_MCP_ISERROR);
    assert.equal(report.paymentSent, false);
    assert.equal(report.paymentSignatureSent, false);
    assert.equal(report.wire.toolsListHttpStatus, 200);
    assert.equal(report.wire.toolsCallHttpStatus, 200);
    assert.equal(report.wire.toolsCallIsError, true);
    assert.equal(report.wire.toolsCallHasJsonRpcError, false);
    assert.equal(report.wire.paymentRequiredHeader, false);
    assert.equal(report.toolsList.classified.paymentRequired, true);
    assert.equal(report.toolsList.classified.amount, SDS.amountAtomic);
    assert.equal(report.toolsCall.classified.kind, "unpaid_mcp_iserror_challenge");
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
    assert.equal(report.wire.productionToolsCallHttpStatus, 200);
    assert.equal(report.wire.productionToolsCallIsError, true);
    assert.equal(report.wire.productionJsonrpcError, false);
    assert.equal(report.wire.productionPaymentRequiredHeader, false);
    assert.equal(report.wire.productionSettle, 0);
    assert.equal(report.wire.productionVerify, 0);
    assert.equal(report.production.toolsCall.classified.kind, "unpaid_mcp_iserror_challenge");
    assert.equal(report.production.toolsCall.classified.isError, true);
    assert.equal(report.production.toolsCall.classified.charged, false);
    assert.equal(report.production.toolsCall.classified.amount, SDS.amountAtomic);
    assert.equal(report.production.toolsCall.classified.resourceUrl, SDS.mcpResourceUrl);
    assert.match(result.stderr, /w829-mcp-iserror cold: pass/);
  },
);
