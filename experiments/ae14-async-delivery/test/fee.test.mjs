import assert from "node:assert/strict";
import test from "node:test";
import { BoundaryError } from "../src/boundary.mjs";
import { assertSingleCapture, cumulativeFloorDelta, feeAt, singleCaptureTotals } from "../src/fee.mjs";
import { buildQuote, isLegacyTerms, legacyRefusal } from "../src/quote.mjs";
import { future, parties } from "./helpers.mjs";

test("per-capture floor hits the 19, 20 and 21 atomic boundaries", () => {
  assert.equal(feeAt("19"), "0");
  assert.equal(feeAt("20"), "1");
  assert.equal(feeAt("21"), "1");
  assert.deepEqual(singleCaptureTotals("19"), expectTotals("19", "0", "19"));
  assert.deepEqual(singleCaptureTotals("20"), expectTotals("20", "1", "19"));
  assert.deepEqual(singleCaptureTotals("21"), expectTotals("21", "1", "20"));
  assert.equal(feeAt("10000"), "500");
  const max = (2n ** 120n - 1n).toString();
  const fee = (BigInt(max) * 500n / 10000n).toString();
  assert.equal(feeAt(max), fee);
  assert.equal(BigInt(max), BigInt(fee) + BigInt(singleCaptureTotals(max).contributorNet));
});

test("a split is not priced as one cumulative floor", () => {
  assert.equal(cumulativeFloorDelta(["19", "1"]), "1");
  assert.equal(cumulativeFloorDelta(["20"]), "0");
  assert.throws(() => assertSingleCapture(["19", "1"]), (error) => error instanceof BoundaryError && error.code === "unsupported_partial_capture");
  assert.throws(() => feeAt((2n ** 120n).toString()), (error) => error.code === "commerce_amount_overflow");
  assert.throws(() => singleCaptureTotals("20", "1"), (error) => error.code === "unsupported_capture_cost_deduction");
});

test("legacy 221400 and 234100 terms are not repriced", () => {
  assert.equal(isLegacyTerms("221400"), true);
  assert.equal(isLegacyTerms("234100"), true);
  assert.equal(isLegacyTerms("234100-frozen"), true);
  assert.equal(isLegacyTerms("e08-async-v1"), false);
  for (const termsVersion of ["221400", "234100"]) {
    const refusal = legacyRefusal({ termsVersion, earnedNet: "100000" });
    assert.equal(refusal.feeApplied, false);
    assert.equal(refusal.repriced, false);
    assert.equal(refusal.walletRequired, false);
    assert.equal(refusal.earnedNet, "100000");
    assert.equal(refusal.platformFee, null);
    assert.equal(refusal.qualification, "pending-join");
  }
});

test("new quotes keep rail cost separate and refuse production assets", () => {
  const built = buildQuote({ ...parties, ...ids(), gross: "21", expiresAt: future() });
  assert.equal(built.quote.platformFee, "1");
  assert.equal(built.quote.contributorNet, "20");
  assert.equal(built.quote.rail.costCap, "0");
  assert.equal(built.quote.fee.profile.rounding, "per_capture_floor");
  assert.equal(built.quote.fee.profile.mode, "single_capture");
  assert.equal(built.quote.fee.profile.escrow.commit, "6b0a5ef3f0df973857f558e2d6b5dd645b5e97f9");
  assert.throws(() => buildQuote({
    ...parties,
    ...ids(),
    gross: "20",
    expiresAt: future(),
    asset: { ...parties.asset, chain: "eip155:8453" },
  }), (error) => error.code === "disposable_chain_only");
  assert.throws(() => buildQuote({
    ...parties,
    ...ids(),
    gross: "20",
    expiresAt: future(),
    asset: { ...parties.asset, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  }), (error) => error.code === "production_asset_refused");
});

function ids() {
  return { quoteId: "quote-fee", taskId: "task-fee", canonicalTaskId: "job-fee" };
}

function expectTotals(gross, platformFee, contributorNet) {
  return {
    gross,
    platformFee,
    contributorNet,
    railCost: "0",
    subsidy: "0",
    profile: "per_capture_floor_500",
    rounding: "per_capture_floor",
    cumulativeFloorDelta: "0",
  };
}
