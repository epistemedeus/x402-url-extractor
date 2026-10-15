import assert from "node:assert/strict";
import test from "node:test";
import { perCaptureFloor, reconcileAcceptedCapture } from "../reconcile/fee.mjs";

const DIGEST = "ab".repeat(32);

function capture(overrides = {}) {
  return {
    state: "captured",
    finality: "final",
    bound: true,
    gross: "105263",
    platformFee: "5263",
    contributorNet: "100000",
    railCost: "0",
    acceptedDigest: DIGEST,
    ...overrides,
  };
}

test("per-capture floor is not a cumulative reprice", () => {
  assert.equal(perCaptureFloor("19").platformFee, "0");
  assert.equal(perCaptureFloor("20").platformFee, "1");
  assert.equal(perCaptureFloor("21").platformFee, "1");
  assert.equal(perCaptureFloor("38").platformFee, "1");
  const row = perCaptureFloor("105263");
  assert.equal(row.status, "computed");
  assert.equal(row.platformFee, "5263");
  assert.equal(row.contributorNet, "100000");
  assert.equal(row.railCost, "0");
  assert.equal(perCaptureFloor("0").status, "unknown");
  assert.equal(perCaptureFloor("20", "1").status, "unknown");
  assert.equal(perCaptureFloor("nope").status, "unknown");
});

test("a capture mismatch stays unknown", () => {
  const port = { invocations: 1, lastFeeAmount: "5263" };
  const matched = reconcileAcceptedCapture({ acceptedDigest: DIGEST, capture: capture(), port });
  assert.equal(matched.status, "matched");
  assert.equal(matched.invocations, 1);
  assert.equal(reconcileAcceptedCapture({ acceptedDigest: "cd".repeat(32), capture: capture(), port }).reason, "digest_mismatch");
  assert.equal(reconcileAcceptedCapture({ acceptedDigest: DIGEST, capture: capture({ state: "authorized" }), port }).status, "unknown");
  assert.equal(reconcileAcceptedCapture({ acceptedDigest: DIGEST, capture: capture(), port: { invocations: 2, lastFeeAmount: "5263" } }).reason, "capture_count");
  assert.equal(reconcileAcceptedCapture({ acceptedDigest: DIGEST, capture: capture({ platformFee: "0", contributorNet: "105263" }), port }).reason, "fee_mismatch");
  assert.equal(reconcileAcceptedCapture({ acceptedDigest: DIGEST, capture: null, port }).status, "unknown");
});
