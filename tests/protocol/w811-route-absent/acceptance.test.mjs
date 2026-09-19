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

test("cli refuses --pay/--live/--cdp/--publish/--neo (exit 2)", async () => {
  for (const flag of ["--pay", "--live", "--cdp", "--publish", "--neo"]) {
    const result = await runCheck([flag]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(report.ok, false);
    assert.equal(report.code, "refused");
  }
});

test("cli --all-fixtures classifies pass and reject traces", async () => {
  const result = await runCheck(["--all-fixtures"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(report.ok, true);
  assert.equal(report.counted, 10);
});

test("cli --seeded-failure rejects absent-route-as-402 (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "absent_route_classified_as_402");
  assert.equal(report.id, "seeded-absent-route-as-402");
  assert.equal(report.settleCount, 1);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=absent_route_classified_as_402/);
});

test("cli fixture path rejects seeded-absent-route-settled (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-absent-route-settled.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, "absent_route_settle");
});

test("runSeededFailure matches the CLI reject", () => {
  const report = runSeededFailure();
  assert.equal(report.ok, false);
  assert.equal(report.code, "absent_route_classified_as_402");
  assert.equal(report.settleCount, 1);
});

test(
  "cli --cold exits 0 against loopback server.js: absent path is not 402, /extract still is",
  { timeout: 180_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report.failed, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "server.js");
    assert.equal(report.code, "route-absent-holds");
    assert.equal(report.counted, 4);
    assert.equal(report.paymentSent, false);
    assert.deepEqual(report.settleCounts, [0, 0, 0, 0]);
    assert.match(result.stderr, /w811-route-absent cold: pass/);
    const byId = Object.fromEntries(report.scenarios.map((row) => [row.id, row]));
    const paid = byId["x402-declared-paid-control"];
    assert.ok(paid.paidControl402 >= 1);
    assert.equal(paid.attempts[0].httpStatus, 402);
    const casefold = paid.attempts.find((attempt) => attempt.phase === "paid-control-casefold");
    assert.equal(casefold.httpStatus, 402);
    const free = byId["x402-declared-free-not-absent"];
    assert.ok(free.attempts[0].httpStatus >= 200 && free.attempts[0].httpStatus < 300);
    assert.notEqual(free.attempts[0].httpStatus, 402);
    const absent = byId["x402-route-absent-http"];
    assert.ok(absent.absentAttempts >= 5);
    assert.equal(absent.absentAs402, 0);
    assert.equal(absent.settleCount, 0);
    assert.equal(absent.verifyCount, 0);
    assert.notEqual(absent.attempts[0].httpStatus, 402);
    assert.equal(absent.attempts[0].hasPaymentRequired, false);
    assert.equal(absent.wellKnown.includesAbsentRoute, false);
    const catalog = byId["x402-catalog-route-absent"];
    assert.equal(catalog.catalog.priceObservationStatus, "route_absent");
    assert.equal(catalog.catalog.expectedRouteFound, false);
    assert.equal(catalog.catalog.originFoundExpectedRouteAbsent, true);
    assert.equal(catalog.catalog.identityStatuses["8004market-public-search"], "route_absent");
    assert.equal(catalog.catalog.safety.paymentSentToCatalogs, false);
  },
);
