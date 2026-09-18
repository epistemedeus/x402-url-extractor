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
import { evaluateAmountMatrix } from "./evaluate.mjs";
import { captureUnpaidMatrix, startLocalMerchant } from "./probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "check.mjs");
const REPO = join(HERE, "../../..");

function spawnCheck(args, timeout = 15_000) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    cwd: REPO,
    timeout,
  });
}

function reportFrom(result) {
  const text = result.stdout.trim();
  return JSON.parse(text.slice(text.indexOf("{")));
}

test("canonical fixture via CLI exits 0", () => {
  const result = spawnCheck(["canonical"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.deepEqual(report.codes, [CODES.OK]);
});

test("seeded-failure CLI exits 1 copy_extract_onto_scan", () => {
  const result = spawnCheck(["--seeded-failure"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.AMOUNT_MISMATCH), true);
  assert.equal(report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN), true);
  assert.match(result.stderr, /SEEDED_FAILURE rejected/);
});

test("all bundled fixtures classify as expected", () => {
  const result = spawnCheck(["--all-fixtures"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.ok(report.counted >= 5);
});

test("check.mjs refuses --live --pay --neo --publish", () => {
  for (const flag of ["--live", "--pay", "--neo", "--publish", "--cdp"]) {
    const result = spawnCheck([flag, "canonical"]);
    assert.equal(result.status, 2, flag + result.stdout + result.stderr);
    assert.match(result.stderr, /is refused/);
  }
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
    assert.equal(row.payTo.toLowerCase(), SDS.payTo.toLowerCase());
    assert.ok(row.openapi402Text.includes(route.openapi402Token), row.openapi402Text);
  }
  assert.equal(byId.extract.httpAmount, EXTRACT_AMOUNT_ATOMIC);
  assert.equal(byId.scan.httpAmount, SCAN_AMOUNT_ATOMIC);
  assert.equal(byId["transaction-receipt"].httpAmount, TX_RECEIPT_AMOUNT_ATOMIC);
  assert.equal(JSON.stringify(captured).includes("loyaltyPoints"), false);
});

test("check.mjs --cold --origin against a spawned merchant exits 0", { timeout: 120_000 }, async (t) => {
  const merchant = await startLocalMerchant();
  t.after(() => merchant.close());
  const result = spawnCheck(["--cold", "--origin", merchant.base], 60_000);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = reportFrom(result);
  assert.equal(report.ok, true);
  assert.equal(report.coldRun.paymentHeadersSent, false);
  const scan = report.rows.find((row) => row.id === "scan");
  assert.equal(scan.httpAmount, SCAN_AMOUNT_ATOMIC);
});
