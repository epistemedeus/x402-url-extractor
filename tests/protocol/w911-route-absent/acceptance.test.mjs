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
  assert.equal(report.counted, 8);
});

test("cli --seeded-failure rejects route_absent classified as demand (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND);
  assert.equal(report.id, "seeded-route-absent-as-demand");
  assert.equal(report.claims.demand, true);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=route_absent_classified_as_demand/);
});

test("cli fixture path rejects HTTP 404 treated as 402 (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-404-as-402.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ABSENCE_TREATED_AS_402);
});

test("cli fixture path rejects matched-price claim (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-route-absent-as-matched.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_MATCHED);
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
  assert.equal(report.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND);
});

test(
  "cli --cold exits 0 against agent-discoverability-audit.mjs and flag-off server.js",
  { timeout: 90_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "agent-discoverability-audit.mjs+server.js");
    assert.equal(report.code, CODES.ROUTE_ABSENT);
    assert.equal(report.paymentSent, false);
    assert.equal(report.paymentSignatureSent, false);
    assert.equal(report.catalog.code, CODES.ROUTE_ABSENT);
    assert.equal(report.originFound.code, CODES.ORIGIN_FOUND_EXPECTED_ROUTE_ABSENT);
    assert.equal(report.merchant.code, CODES.MERCHANT_ROUTE_ABSENT);
    assert.equal(report.wire.catalogPriceSample, "route_absent");
    assert.equal(report.wire.catalogIdentitySample, "route_absent");
    assert.equal(report.wire.originFoundFinding, true);
    assert.equal(report.wire.originFoundPrice, "route_absent");
    assert.equal(report.wire.lockfileHttpStatus, 404);
    assert.equal(report.wire.extractHttpStatus, 402);
    assert.equal(report.wire.paymentRequiredHeader, false);
    assert.equal(report.wire.advertisedOpenApi, false);
    assert.equal(report.wire.facilitatorVerify, 0);
    assert.equal(report.wire.facilitatorSettle, 0);
    assert.equal(report.wire.route, SDS.lockfilePath);
    assert.equal(report.boundary.neoTouched, false);
    assert.match(result.stderr, /w911-route-absent cold: pass/);
  },
);
