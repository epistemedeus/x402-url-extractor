import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CODES,
  EXTRACT_AMOUNT_ATOMIC,
  MATRIX,
  SCAN_AMOUNT_ATOMIC,
  SDS,
  TX_RECEIPT_AMOUNT_ATOMIC,
} from "./constants.mjs";
import { amountsEqual, evaluateAmountMatrix } from "./evaluate.mjs";
import { BUNDLED } from "./check.mjs";
import { buildCanonicalFixture } from "./fixtures.mjs";
import { captureUnpaidMatrix, startLocalMerchant } from "./probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "check.mjs");
const COLD = join(HERE, "cold-run.mjs");
const REPO_ROOT = join(HERE, "../../..");

function spawnCheck(args) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
}

function reportFrom(result) {
  const text = result.stdout.trim();
  return JSON.parse(text.slice(text.indexOf("{")));
}

test("canonical fixture exits 0 with string-exact scan 200000 / tx-receipt 2000 / extract 5000", () => {
  const result = spawnCheck(["canonical"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.deepEqual(report.codes, [CODES.OK]);
  const byId = Object.fromEntries(report.rows.map((row) => [row.id, row]));
  assert.equal(byId.extract.httpAmount, EXTRACT_AMOUNT_ATOMIC);
  assert.equal(byId.scan.httpAmount, SCAN_AMOUNT_ATOMIC);
  assert.equal(byId["transaction-receipt"].httpAmount, TX_RECEIPT_AMOUNT_ATOMIC);
  assert.equal(byId.scan.mcpAmount, SCAN_AMOUNT_ATOMIC);
  assert.equal(amountsEqual(byId.scan.httpAmount, byId.scan.mcpAmount), true);
  assert.equal(report.payTo, SDS.payTo);
  assert.equal(report.boundary.unitsConverted, false);
  assert.equal(report.paymentAttempted, false);
  assert.equal(report.wave, "w930");
});

test("JSON canonical fixture on disk matches the builder and exits 0", () => {
  const result = spawnCheck([BUNDLED.canonical]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
});

test("seeded copy of extract 5000 onto /scan exits 1 amount_mismatch", () => {
  const result = spawnCheck(["--seeded-failure"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.AMOUNT_MISMATCH), true);
  assert.equal(report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN), true);
  const scan = report.rows.find((row) => row.id === "scan");
  assert.equal(scan.httpAmount, EXTRACT_AMOUNT_ATOMIC);
  assert.equal(scan.expectedAmountAtomic, SCAN_AMOUNT_ATOMIC);
  assert.equal(amountsEqual(scan.httpAmount, scan.expectedAmountAtomic), false);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
});

test("seeded invented loyaltyPoints / throughBlock exits 1", () => {
  const result = spawnCheck(["seeded-invented-field"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.INVENTED_FIELD), true);
  assert.ok(report.invented.includes("loyaltyPoints"));
  assert.ok(report.invented.includes("throughBlock"));
});

test("treating missing /scan as buyer demand exits 1", () => {
  const result = spawnCheck(["treat-absence-as-demand"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.TREAT_ABSENCE_AS_DEMAND), true);
  assert.equal(report.codes.includes(CODES.OK), false);
});

test("numeric or display-unit scan amounts are unit_conversion_refused", () => {
  const fixture = buildCanonicalFixture();
  fixture.observed.http["/scan"].accepts[0].amount = 200000;
  const numeric = evaluateAmountMatrix(fixture);
  assert.equal(numeric.ok, false);
  assert.equal(numeric.codes.includes(CODES.INVALID_AMOUNT_TYPE), true);
  assert.equal(numeric.codes.includes(CODES.UNIT_CONVERSION), true);

  fixture.observed.http["/scan"].accepts[0].amount = "0.20";
  fixture.observed.mcp.tools.find((tool) => tool.name === "scan")._meta.x402.accepts[0].amount = "0.20";
  const display = evaluateAmountMatrix(fixture);
  assert.equal(display.ok, false);
  assert.equal(display.codes.includes(CODES.UNIT_CONVERSION), true);
  assert.equal(display.boundary.unitsConverted, true);
});

test("check.mjs refuses --live and --pay", () => {
  const live = spawnCheck(["--live", "canonical"]);
  assert.equal(live.status, 2);
  assert.match(live.stderr, /--live is refused/);
  const pay = spawnCheck(["--pay"]);
  assert.equal(pay.status, 2);
  const neo = spawnCheck(["--neo", "canonical"]);
  assert.equal(neo.status, 2);
});

test("cold unpaid local merchant matches the amount matrix", { timeout: 120_000 }, async (t) => {
  const merchant = await startLocalMerchant();
  t.after(() => merchant.close());
  const captured = await captureUnpaidMatrix(merchant.base);
  const report = evaluateAmountMatrix(captured);
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.paymentAttempted, false);
  const byId = Object.fromEntries(report.rows.map((row) => [row.id, row]));
  for (const route of MATRIX) {
    const row = byId[route.id];
    assert.equal(row.httpStatus, 402, route.path);
    assert.equal(row.httpAmount, route.amountAtomic, `${route.path} http amount`);
    assert.equal(row.mcpAmount, route.amountAtomic, `${route.path} mcp amount`);
    assert.equal(amountsEqual(row.httpAmount, row.mcpAmount), true);
    assert.equal(row.payTo.toLowerCase(), SDS.payTo.toLowerCase());
    assert.ok(row.openapi402Text.includes(route.openapi402Token), row.openapi402Text);
  }
  assert.equal(byId.extract.httpAmount, "5000");
  assert.equal(byId.scan.httpAmount, "200000");
  assert.equal(byId["transaction-receipt"].httpAmount, "2000");
  assert.equal(captured.paymentAttempted, false);
  assert.equal(JSON.stringify(captured).includes("loyaltyPoints"), false);
});

test("cold-run.mjs CLI against a spawned merchant exits 0", { timeout: 120_000 }, async (t) => {
  const merchant = await startLocalMerchant();
  t.after(() => merchant.close());
  const result = spawnSync(process.execPath, [COLD, "--origin", merchant.base], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.equal(report.coldRun.paymentHeadersSent, false);
  const scan = report.rows.find((row) => row.id === "scan");
  assert.equal(scan.httpAmount, "200000");
});
