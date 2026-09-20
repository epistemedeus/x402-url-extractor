import assert from "node:assert/strict";
import test from "node:test";

import {
  CODES,
  EXTRACT_AMOUNT_ATOMIC,
  MATRIX,
  SCAN_AMOUNT_ATOMIC,
  SDS,
  TX_RECEIPT_AMOUNT_ATOMIC,
} from "./constants.mjs";
import { amountsEqual, evaluateAmountMatrix, openapiTokenPresent } from "./evaluate.mjs";
import {
  canonicalFixture,
  seededAbsenceAsDemandFixture,
  seededExtractOntoScanFixture,
  seededInventedFieldFixture,
  seededUnitConversionFixture,
} from "./fixture-builder.mjs";
import { CANONICAL, SEEDED_EXTRACT_ONTO_SCAN, loadJson } from "./paths.mjs";

test("canonical fixture matches scan 200000 / tx-receipt 2000 / extract 5000 as strings", () => {
  const report = evaluateAmountMatrix(canonicalFixture());
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
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.rows.length, MATRIX.length);
});

test("on-disk canonical fixture evaluates the same as the builder", () => {
  const fromDisk = evaluateAmountMatrix(loadJson(CANONICAL));
  const fromBuilder = evaluateAmountMatrix(canonicalFixture());
  assert.equal(fromDisk.ok, true);
  assert.deepEqual(fromDisk.codes, fromBuilder.codes);
  assert.equal(fromDisk.rows.length, fromBuilder.rows.length);
});

test("seeded copy of extract 5000 onto /scan is refused", () => {
  const report = evaluateAmountMatrix(seededExtractOntoScanFixture());
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.AMOUNT_MISMATCH), true);
  assert.equal(report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN), true);
  const scan = report.rows.find((row) => row.id === "scan");
  assert.equal(scan.httpAmount, EXTRACT_AMOUNT_ATOMIC);
  assert.equal(scan.expectedAmountAtomic, SCAN_AMOUNT_ATOMIC);
  assert.equal(amountsEqual(scan.httpAmount, scan.expectedAmountAtomic), false);
});

test("on-disk seeded extract-onto-scan fixture is refused", () => {
  const report = evaluateAmountMatrix(loadJson(SEEDED_EXTRACT_ONTO_SCAN));
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.COPY_EXTRACT_ONTO_SCAN), true);
});

test("seeded invented loyaltyPoints / throughBlock is refused", () => {
  const report = evaluateAmountMatrix(seededInventedFieldFixture());
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.INVENTED_FIELD), true);
  assert.ok(report.invented.includes("loyaltyPoints"));
  assert.ok(report.invented.includes("throughBlock"));
});

test("treating missing /scan as buyer demand is refused", () => {
  const report = evaluateAmountMatrix(seededAbsenceAsDemandFixture());
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.TREAT_ABSENCE_AS_DEMAND), true);
  assert.equal(report.codes.includes(CODES.OK), false);
});

test("numeric or display-unit scan amounts are unit_conversion_refused", () => {
  const fixture = canonicalFixture();
  fixture.observed.http["/scan"].accepts[0].amount = 200000;
  const numeric = evaluateAmountMatrix(fixture);
  assert.equal(numeric.ok, false);
  assert.equal(numeric.codes.includes(CODES.INVALID_AMOUNT_TYPE), true);
  assert.equal(numeric.codes.includes(CODES.UNIT_CONVERSION), true);

  const display = evaluateAmountMatrix(seededUnitConversionFixture());
  assert.equal(display.ok, false);
  assert.equal(display.codes.includes(CODES.UNIT_CONVERSION), true);
  assert.equal(display.boundary.unitsConverted, true);
});

test("amountsEqual is string identity, not numeric", () => {
  assert.equal(amountsEqual("200000", "200000"), true);
  assert.equal(amountsEqual("200000", "0.20"), false);
  assert.equal(amountsEqual("200000", 200000), false);
  assert.equal(amountsEqual("5000", "200000"), false);
});

test("missing HTTP amount or payTo fails closed", () => {
  const missingAmount = canonicalFixture();
  delete missingAmount.observed.http["/extract"].accepts[0].amount;
  const amountReport = evaluateAmountMatrix(missingAmount);
  assert.equal(amountReport.ok, false);
  assert.equal(amountReport.codes.includes(CODES.AMOUNT_MISMATCH), true);

  const missingPayTo = canonicalFixture();
  delete missingPayTo.observed.http["/scan"].accepts[0].payTo;
  const payToReport = evaluateAmountMatrix(missingPayTo);
  assert.equal(payToReport.ok, false);
  assert.equal(payToReport.codes.includes(CODES.PAY_TO_MISMATCH), true);
});

test("wrong-network HTTP accept is not treated as a match", () => {
  const fixture = canonicalFixture();
  fixture.observed.http["/scan"].accepts[0].network = "eip155:1";
  const report = evaluateAmountMatrix(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.ACCEPT_TERMS_MISMATCH), true);
  assert.equal(report.codes.includes(CODES.AMOUNT_MISMATCH), true);
});

test("OpenAPI $0.200 is not a $0.20 token match", () => {
  assert.equal(openapiTokenPresent("payment required (x402, $0.20 USDC base)", "$0.20"), true);
  assert.equal(openapiTokenPresent("payment required (x402, $0.200 USDC base)", "$0.20"), false);
  const fixture = canonicalFixture();
  fixture.observed.openapi.paths["/scan"].get.responses["402"].description = "payment required (x402, $0.200 USDC base)";
  const report = evaluateAmountMatrix(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.codes.includes(CODES.OPENAPI_402_TEXT_MISMATCH), true);
});
