import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CODES,
  EXTRACT_AMOUNT_ATOMIC,
  MATRIX,
  SCAN_AMOUNT_ATOMIC,
  SDS,
  TX_RECEIPT_AMOUNT_ATOMIC,
} from "./constants.mjs";
import { amountsEqual, evaluateAmountMatrix } from "./evaluate.mjs";
import {
  CANONICAL,
  SEEDED_EXTRACT_ONTO_SCAN,
  SEEDED_INVENTED_FIELD,
  SEEDED_UNIT_CONVERSION,
  TREAT_ABSENCE_AS_DEMAND,
} from "./paths.mjs";

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("canonical fixture matches string-exact extract 5000 / scan 200000 / tx-receipt 2000", () => {
  const report = evaluateAmountMatrix(load(CANONICAL));
  assert.equal(report.ok, true, JSON.stringify(report.codes));
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
  assert.equal(report.rows.length, MATRIX.length);
});

test("seeded copy of extract 5000 onto /scan is amount_mismatch", () => {
  const report = evaluateAmountMatrix(load(SEEDED_EXTRACT_ONTO_SCAN));
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.AMOUNT_MISMATCH), true);
  assert.equal(report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN), true);
  const scan = report.rows.find((row) => row.id === "scan");
  assert.equal(scan.httpAmount, EXTRACT_AMOUNT_ATOMIC);
  assert.equal(scan.expectedAmountAtomic, SCAN_AMOUNT_ATOMIC);
  assert.equal(amountsEqual(scan.httpAmount, scan.expectedAmountAtomic), false);
});

test("seeded invented loyaltyPoints / throughBlock is refused", () => {
  const report = evaluateAmountMatrix(load(SEEDED_INVENTED_FIELD));
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.INVENTED_FIELD), true);
  assert.ok(report.invented.includes("loyaltyPoints"));
  assert.ok(report.invented.includes("throughBlock"));
});

test("treating missing /scan as buyer demand is refused", () => {
  const report = evaluateAmountMatrix(load(TREAT_ABSENCE_AS_DEMAND));
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.TREAT_ABSENCE_AS_DEMAND), true);
  assert.equal(report.codes.includes(CODES.OK), false);
});

test("display-unit scan amount is unit_conversion_refused", () => {
  const report = evaluateAmountMatrix(load(SEEDED_UNIT_CONVERSION));
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.UNIT_CONVERSION), true);
  assert.equal(report.boundary.unitsConverted, true);
});

test("numeric scan amount is invalid_amount_type", () => {
  const fixture = load(CANONICAL);
  fixture.observed.http["/scan"].accepts[0].amount = 200000;
  const report = evaluateAmountMatrix(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.INVALID_AMOUNT_TYPE), true);
  assert.equal(report.codes.includes(CODES.UNIT_CONVERSION), true);
});

test("malformed document is malformed_fixture", () => {
  const report = evaluateAmountMatrix(null);
  assert.equal(report.ok, false);
  assert.deepEqual(report.codes, [CODES.MALFORMED_FIXTURE]);
});

test("amountsEqual is string-exact and refuses number coercion", () => {
  assert.equal(amountsEqual("200000", "200000"), true);
  assert.equal(amountsEqual("200000", "0.20"), false);
  assert.equal(amountsEqual("5000", 5000), false);
  assert.equal(amountsEqual("200000", "200000.0"), false);
});
