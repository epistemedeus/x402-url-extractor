import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXTRACT_BATCH_AMOUNT_ATOMIC,
  EXTRACT_BATCH_METHOD,
  EXTRACT_BATCH_PATH,
} from "../../../extract-batch-config.mjs";
import { BATCH, CODES, EXTRACT_GET, SCHEMA_FIXTURE } from "./constants.mjs";
import {
  classifyFixture,
  evaluateFixtureCorpus,
  evaluateObservation,
  isGetExtractRewrite,
} from "./evaluate.mjs";
import {
  loadFixture,
  loadFixtures,
  loadManifest,
  listPassFixtureFiles,
  listRejectFixtureFiles,
} from "./paths.mjs";

test("pins match extract-batch-config and are not GET /extract 5000", () => {
  assert.equal(BATCH.path, EXTRACT_BATCH_PATH);
  assert.equal(BATCH.method, EXTRACT_BATCH_METHOD);
  assert.equal(BATCH.amountAtomic, EXTRACT_BATCH_AMOUNT_ATOMIC);
  assert.equal(BATCH.amountAtomic, "10000");
  assert.equal(EXTRACT_GET.path, "/extract");
  assert.equal(EXTRACT_GET.amountAtomic, "5000");
  assert.notEqual(BATCH.path, EXTRACT_GET.path);
  assert.notEqual(BATCH.amountAtomic, EXTRACT_GET.amountAtomic);
});

test("manifest lists every pass and reject fixture", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, SCHEMA_FIXTURE);
  const listedPass = manifest.fixtures.filter((entry) => entry.expect === "pass").map((entry) => entry.path).sort();
  const listedReject = manifest.fixtures.filter((entry) => entry.expect === "reject").map((entry) => entry.path).sort();
  assert.deepEqual(listedPass, listPassFixtureFiles());
  assert.deepEqual(listedReject, listRejectFixtureFiles());
});

test("pass fixtures classify as native POST /extract/batch 402 amount 10000", () => {
  for (const entry of loadFixtures("pass")) {
    const evaluated = evaluateObservation(entry.fixture);
    assert.equal(evaluated.ok, true, `${entry.id}: ${evaluated.code} ${JSON.stringify(evaluated.violations)}`);
    assert.equal(evaluated.code, CODES.NATIVE);
    assert.equal(evaluated.rewrite, false);
    assert.equal(evaluated.path, BATCH.path);
    assert.equal(evaluated.method, "POST");
    assert.equal(evaluated.amount, BATCH.amountAtomic);
    assert.equal(evaluated.httpStatus, 402);
    assert.deepEqual(evaluated.emittedR602, []);
    assert.equal(evaluated.emittedR602.includes("unsupported_target"), false);
  }
});

test("seeded GET /extract rewrite claim is not_extract_rewrite, not one_paywall 5000", () => {
  const fixture = loadFixture("reject/seeded-get-extract-rewrite.json");
  const evaluated = evaluateObservation(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.NOT_EXTRACT_REWRITE);
  assert.equal(evaluated.rewrite, false);
  assert.equal(evaluated.path, BATCH.path);
  assert.equal(evaluated.amount, BATCH.amountAtomic);
  assert.equal(evaluated.claimsRejected, true);
  assert.equal(evaluated.code === "unsupported_target", false);
  assert.equal(evaluated.code === "one_paywall", false);
  assert.deepEqual(evaluated.emittedR602, []);
  assert.equal(fixture.claims.one_paywall, true);
  assert.equal(fixture.claims.amountAtomic, EXTRACT_GET.amountAtomic);
});

test("actual GET /extract rewritten as POST is not native batch", () => {
  const fixture = loadFixture("reject/seeded-rewrite-presented-as-native.json");
  assert.equal(isGetExtractRewrite(fixture), true);
  const evaluated = evaluateObservation(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.NOT_EXTRACT_REWRITE);
  assert.equal(evaluated.rewrite, true);
  assert.equal(evaluated.path, EXTRACT_GET.path);
  assert.notEqual(evaluated.code, "unsupported_target");
  assert.notEqual(evaluated.verdict, "one_paywall");
});

test("copying extract 5000 onto POST /extract/batch is amount_mismatch", () => {
  const evaluated = evaluateObservation(loadFixture("reject/seeded-amount-mismatch.json"));
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.AMOUNT_MISMATCH);
  assert.equal(evaluated.amount, EXTRACT_GET.amountAtomic);
  assert.ok(evaluated.violations.some((item) => item.code === CODES.AMOUNT_MISMATCH));
});

test("invented receipt field loyaltyPoints is rejected", () => {
  const evaluated = evaluateObservation(loadFixture("reject/seeded-invented-field.json"));
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.INVENTED_RECEIPT_FIELD);
  assert.ok(evaluated.invented.includes("loyaltyPoints"));
});

test("treating catalog absence as demand is rejected", () => {
  const evaluated = evaluateObservation(loadFixture("reject/seeded-absence-as-demand.json"));
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.TREAT_ABSENCE_AS_DEMAND);
});

test("numeric or display amounts are not coerced to 10000", () => {
  const fixture = loadFixture("pass/native-post-extract-batch-402.json");
  const asNumber = structuredClone(fixture);
  asNumber.challenge.accepts[0].amount = 10000;
  const numeric = evaluateObservation(asNumber);
  assert.equal(numeric.ok, false);
  assert.equal(numeric.code, CODES.AMOUNT_MISMATCH);

  const asDisplay = structuredClone(fixture);
  asDisplay.challenge.accepts[0].amount = "0.01";
  const display = evaluateObservation(asDisplay);
  assert.equal(display.ok, false);
  assert.equal(display.code, CODES.AMOUNT_MISMATCH);
});

test("PAYMENT-SIGNATURE is payment_sent", () => {
  const fixture = structuredClone(loadFixture("pass/native-post-extract-batch-402.json"));
  fixture.request.headers["payment-signature"] = "e30=";
  const evaluated = evaluateObservation(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, CODES.PAYMENT_SENT);
});

test("suite never emits R6-02 unsupported_target", () => {
  for (const kind of ["pass", "reject"]) {
    for (const entry of loadFixtures(kind)) {
      const evaluated = evaluateObservation(entry.fixture);
      assert.notEqual(evaluated.code, "unsupported_target", entry.id);
      assert.equal(evaluated.emittedR602.includes("unsupported_target"), false, entry.id);
    }
  }
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed, null, 2));
  assert.equal(report.counted, 7);
  assert.equal(classifyFixture(loadFixture("reject/seeded-get-extract-rewrite.json")).fixtureVerdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/native-post-extract-batch-402.json")).fixtureVerdict, "pass");
});
