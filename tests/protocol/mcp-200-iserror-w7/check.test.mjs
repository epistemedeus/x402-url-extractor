import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const check = path.join(here, "check.mjs");

function runCheck(args, { timeout = 20_000 } = {}) {
  return spawnSync(process.execPath, [check, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
  });
}

function parseStdout(result) {
  const text = String(result.stdout || "").trim();
  assert.notEqual(text, "", "check.mjs must print JSON");
  return JSON.parse(text);
}

test("check --cold mounts real MCP and classifies unpaid tools/call as 200 isError not paid", { timeout: 20_000 }, () => {
  const result = runCheck(["--cold"]);
  const report = parseStdout(result);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(report.ok, true);
  assert.equal(report.outcome, "unpaid_call_is_error");
  assert.equal(report.wire.httpStatus, 200);
  assert.equal(report.wire.isError, true);
  assert.equal(report.paid, false);
  assert.equal(report.isError, true);
  assert.equal(report.kind, "challenge");
  assert.equal(report.charged, false);
  assert.equal(report.liveMerchantCall, false);
  assert.equal(report.paymentSent, false);
  assert.equal(report.calls.settle, 0);
  assert.equal(report.calls.handlerEnrich, 0);
  assert.equal(report.paidClaimRejected, true);
  assert.equal(report.wire.paymentRequiredHeader, null);
  assert.equal(report.wire.hasStructuredAccepts, true);
  assert.equal(report.wire.acceptCount >= 1, true);
  assert.equal(report.wire.x402Version, 2);
});

test("check --seeded-failure rejects HTTP 200 isError claimed paid and exits 1", { timeout: 10_000 }, () => {
  const result = runCheck(["--seeded-failure"]);
  const report = parseStdout(result);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(report.ok, true);
  assert.equal(report.outcome, "rejected");
  assert.equal(report.code, "mcp_200_iserror_must_not_be_paid");
  assert.equal(report.paid, false);
  assert.equal(report.isError, true);
  assert.equal(report.naiveWouldHavePaid, true);
  assert.equal(report.claimed.paid, true);
  assert.match(String(result.stderr), /SEEDED_FAILURE rejected/);
});

test("check --live is refused", () => {
  const result = runCheck(["--live"]);
  const report = parseStdout(result);
  assert.equal(result.status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.error, "forbidden_flag");
  assert.equal(report.flag, "--live");
});
