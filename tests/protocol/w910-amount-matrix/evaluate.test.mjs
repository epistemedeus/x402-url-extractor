import assert from "node:assert/strict";
import { test } from "node:test";

import { CODES, SDS } from "./constants.mjs";
import { classifyAtomic, classifyRouteObservation, stringEqual } from "./classify.mjs";
import { classifyFixture, evaluateFixture, evaluateFixtureCorpus, evaluateRoute } from "./evaluate.mjs";
import {
  FIXTURE_SCHEMA,
  loadFixture,
  loadFixtures,
  loadManifest,
  listPassFixtureFiles,
  listRejectFixtureFiles,
} from "./paths.mjs";

test("manifest lists every pass and reject fixture", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, FIXTURE_SCHEMA);
  const listedPass = manifest.fixtures.filter((entry) => entry.expect === "pass").map((entry) => entry.path).sort();
  const listedReject = manifest.fixtures.filter((entry) => entry.expect === "reject").map((entry) => entry.path).sort();
  assert.deepEqual(listedPass, listPassFixtureFiles());
  assert.deepEqual(listedReject, listRejectFixtureFiles());
});

test("canonical atomic strings never coerce", () => {
  assert.equal(stringEqual("5000", "5000"), true);
  assert.equal(stringEqual("5000", 5000), false);
  assert.equal(stringEqual("5000", "5000.0"), false);
  assert.equal(stringEqual("5000", "5e3"), false);
  assert.equal(stringEqual("5000", "05000"), false);
  assert.equal(stringEqual("200000", "200000.0"), false);
  assert.equal(classifyAtomic("5000").kind, "canonical_string");
  assert.equal(classifyAtomic(5000).kind, "not_string");
  assert.equal(classifyAtomic("5e3").kind, "not_canonical");
  assert.equal(classifyAtomic("05000").kind, "not_canonical");
  assert.equal(classifyAtomic(null).kind, "missing");
});

test("live unpaid extract is HTTP 402 amount string 5000 across surfaces", () => {
  const fixture = loadFixture("pass/live-unpaid-extract.json");
  const classified = classifyRouteObservation(fixture.routeId, fixture.observation, fixture.request);
  assert.equal(classified.httpStatus, 402);
  assert.equal(classified.httpAmount.value, "5000");
  assert.equal(classified.mcpAmount.value, "5000");
  assert.equal(classified.wellKnownAmount.value, "5000");
  assert.equal(classified.openapiPriceUsd, "$0.005");
  assert.equal(classified.payTo, SDS.payTo);
  assert.equal(classified.charged, false);
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.code, CODES.UNPAID_AMOUNT_MATRIX);
});

test("live unpaid scan is HTTP 402 amount string 200000 and OpenAPI $0.20", () => {
  const fixture = loadFixture("pass/live-unpaid-scan.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.classified.httpAmount.value, "200000");
  assert.equal(evaluated.classified.openapiPriceUsd, "$0.20");
});

test("live unpaid transaction-receipt is HTTP 402 amount string 2000 and OpenAPI $0.002", () => {
  const fixture = loadFixture("pass/live-unpaid-tx-receipt.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.classified.httpAmount.value, "2000");
  assert.equal(evaluated.classified.openapiPriceUsd, "$0.002");
});

test("live unpaid matrix aligns extract 5000, scan 200000, tx-receipt 2000", () => {
  const fixture = loadFixture("pass/live-unpaid-matrix.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.classified.amounts.extract.http, "5000");
  assert.equal(evaluated.classified.amounts.scan.http, "200000");
  assert.equal(evaluated.classified.amounts.transaction_receipt.http, "2000");
});

test("seeded scan amount 5000 is rejected as amount_mismatch", () => {
  const fixture = loadFixture("reject/seeded-amount-mismatch.json");
  const evaluated = evaluateRoute(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.AMOUNT_MISMATCH);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded missing amount is rejected", () => {
  const fixture = loadFixture("reject/seeded-missing-amount.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.AMOUNT_MISSING);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded JSON number 5000 is rejected as not a string", () => {
  const fixture = loadFixture("reject/seeded-numeric-amount.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.AMOUNT_NOT_STRING);
  assert.equal(evaluated.classified.httpAmount.kind, "not_string");
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded scientific 5e3 is rejected as not canonical", () => {
  const fixture = loadFixture("reject/seeded-scientific-amount.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.AMOUNT_NOT_CANONICAL);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded padded 05000 is rejected as not canonical", () => {
  const fixture = loadFixture("reject/seeded-padded-amount.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.AMOUNT_NOT_CANONICAL);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded HTTP 200000 vs MCP 5000 is cross-surface drift", () => {
  const fixture = loadFixture("reject/seeded-cross-surface-drift.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.CROSS_SURFACE_DRIFT);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded HTTP 402 classified as settlement is rejected", () => {
  const fixture = loadFixture("reject/seeded-402-as-settlement.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.HTTP_402_CLASSIFIED_AS_SETTLEMENT);
  assert.equal(evaluated.claimsRejected, true);
  assert.equal(evaluated.classified.charged, false);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded missing matrix row treated as demand is rejected", () => {
  const fixture = loadFixture("reject/seeded-absence-as-demand.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.ABSENCE_AS_DEMAND);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded invented loyaltyPoints is rejected", () => {
  const fixture = loadFixture("reject/seeded-invented-field.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.INVENTED_RECEIPT_FIELD);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("seeded OpenAPI $0.005 on scan is rejected", () => {
  const fixture = loadFixture("reject/seeded-openapi-price-mismatch.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.OPENAPI_PRICE_MISMATCH);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("PAYMENT-SIGNATURE on the request is refused", () => {
  const fixture = loadFixture("reject/seeded-payment-signature.json");
  const evaluated = evaluateFixture(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.PAYMENT_SIGNATURE_SENT);
  assert.equal(classifyFixture(fixture).verdict, "rejected");
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 15);
  assert.equal(classifyFixture(loadFixture("reject/seeded-amount-mismatch.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/live-unpaid-matrix.json")).verdict, "pass");
});
