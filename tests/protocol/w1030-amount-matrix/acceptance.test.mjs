import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { CODES, EXTRACT_AMOUNT_ATOMIC, MATRIX, SCAN_AMOUNT_ATOMIC } from "./constants.mjs";
import { CHECK, REPO_ROOT } from "./paths.mjs";

function spawnCheck(args, { timeout = 20_000 } = {}) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

function reportFrom(result) {
  const text = result.stdout.trim();
  return JSON.parse(text.slice(text.indexOf("{")));
}

test("check.mjs --all-fixtures exits 0", () => {
  const result = spawnCheck(["--all-fixtures"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.equal(report.counted, 5);
});

test("check.mjs --seeded-failure exits 1 amount_mismatch / copy_extract_onto_scan", () => {
  const result = spawnCheck(["--seeded-failure"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.AMOUNT_MISMATCH), true);
  assert.equal(report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN), true);
  const scan = report.rows.find((row) => row.id === "scan");
  assert.equal(scan.httpAmount, EXTRACT_AMOUNT_ATOMIC);
  assert.equal(scan.expectedAmountAtomic, SCAN_AMOUNT_ATOMIC);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
});

test("check.mjs refuses --live, --pay, --cdp, --publish, --neo", () => {
  for (const flag of ["--live", "--pay", "--cdp", "--publish", "--neo"]) {
    const result = spawnCheck([flag, "--cold"]);
    assert.equal(result.status, 2, `${flag}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`${flag} is refused`));
  }
});

test("check.mjs --cold against a spawned local merchant exits 0", { timeout: 120_000 }, () => {
  const result = spawnCheck(["--cold"], { timeout: 90_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true, JSON.stringify(report.codes));
  assert.equal(report.paymentAttempted, false);
  assert.equal(report.coldRun.paymentHeadersSent, false);
  assert.equal(report.coldRun.facilitatorSettleCalled, false);
  assert.equal(report.coldRun.facilitatorVerifyCalled, false);
  const byId = Object.fromEntries(report.rows.map((row) => [row.id, row]));
  for (const route of MATRIX) {
    const row = byId[route.id];
    assert.equal(row.httpStatus, 402, route.path);
    assert.equal(row.httpAmount, route.amountAtomic, `${route.path} http amount`);
    assert.equal(row.mcpAmount, route.amountAtomic, `${route.path} mcp amount`);
    assert.ok(row.openapi402Text.includes(route.openapi402Token), row.openapi402Text);
  }
  assert.equal(byId.extract.httpAmount, "5000");
  assert.equal(byId.scan.httpAmount, "200000");
  assert.equal(byId["transaction-receipt"].httpAmount, "2000");
  assert.match(result.stderr, /w1030-amount-matrix cold: pass/);
});
