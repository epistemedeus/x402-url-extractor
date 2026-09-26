import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { ABSENT_PROBES, CODES, SDS } from "./constants.mjs";
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
  assert.equal(report.counted, 12);
});

test("cli --seeded-failure rejects route_absent as demand (exit 1)", async () => {
  const result = await runCheck(["--seeded-failure"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND);
  assert.equal(report.id, "seeded-route-absent-as-demand");
  assert.equal(report.claims.treatAbsenceAsDemand, true);
  assert.equal(report.claimsRejected, true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
  assert.match(result.stderr, /code=route_absent_classified_as_demand/);
});

test("cli fixture path rejects copied extract 402 onto /extract/batch (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-copy-extract-onto-batch.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.ABSENT_ROUTE_AS_402);
});

test("cli fixture path rejects catalog listing of invented path (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-catalog-lists-absent.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.CATALOG_LISTS_ABSENT);
});

test("cli fixture path rejects settle on absent (exit 1)", async () => {
  const result = await runCheck(["fixtures/reject/seeded-absent-settled.json"]);
  const report = parseReport(result.stdout);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(report.ok, false);
  assert.equal(report.code, CODES.SETTLE_ON_ABSENT);
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
  assert.equal(report.code, CODES.ROUTE_ABSENT_CLASSIFIED_AS_DEMAND);
  assert.equal(report.classified.charged, false);
  assert.equal(report.classified.kind, "route_absent");
});

test(
  "cli --cold exits 0 against mounted server.js: present 402, absent 404, no settle",
  { timeout: 90_000 },
  async () => {
    const result = await runCheck(["--cold"]);
    const report = parseReport(result.stdout);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.mode, "cold");
    assert.equal(report.artifact, "server.js");
    assert.equal(report.code, CODES.ROUTE_ABSENT);
    assert.equal(report.paymentSent, false);
    assert.equal(report.wire.presentHttpStatus, 402);
    assert.equal(report.wire.presentPaymentRequiredHeader, true);
    assert.equal(report.present.classified.kind, "present_unpaid_402");
    assert.equal(report.present.classified.amount, SDS.amountAtomic);
    assert.equal(report.present.classified.payTo, SDS.payTo);
    assert.equal(report.absent.length, ABSENT_PROBES.length);
    for (const row of report.wire.absent) {
      assert.equal(row.httpStatus, 404, JSON.stringify(row));
      assert.equal(row.paymentRequiredHeader, false);
    }
    for (const item of report.absent) {
      assert.equal(item.ok, true, JSON.stringify(item.violations));
      assert.equal(item.classified.kind, "route_absent");
    }
    assert.equal(report.signatureAbsent.classified.kind, "route_absent");
    assert.equal(report.signatureAbsent.classified.httpStatus, 404);
    assert.equal(report.counters.verify, 0);
    assert.equal(report.counters.settle, 0);
    const extractCatalog = report.catalog.find((item) => item.path === "/extract");
    assert.equal(extractCatalog.classified.listed, true);
    const inventedCatalog = report.catalog.find((item) => item.path === "/w1031-route-absent");
    assert.equal(inventedCatalog.classified.listed, false);
    assert.equal(inventedCatalog.classified.identityStatus, "route_absent");
    assert.match(result.stderr, /w1031-route-absent cold: pass/);
  },
);
