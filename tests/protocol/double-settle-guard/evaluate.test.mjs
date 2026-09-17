import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyFixture, evaluateTrace, evaluateFixtureCorpus } from "./evaluate.mjs";
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

test("pass traces hold the guard", () => {
  for (const entry of loadFixtures("pass")) {
    const evaluated = evaluateTrace(entry.fixture);
    assert.equal(evaluated.ok, true, `${entry.id}: ${evaluated.code}`);
    assert.equal(evaluated.code, "guard-holds");
    assert.equal(evaluated.settleCount, 1);
    assert.equal(evaluated.boundary.paymentSent, false);
  }
});

test("seeded double-settle is rejected as double_settle", () => {
  const fixture = loadFixture("reject/seeded-double-settle.json");
  const evaluated = evaluateTrace(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "double_settle");
  assert.equal(evaluated.settleCount, 2);
  assert.equal(evaluated.claimsRejected, true);
  assert.ok(evaluated.violations.some((item) => item.code === "distinct_settlement_transactions"));
  assert.ok(evaluated.violations.some((item) => item.code === "seeded_lie_single_settle"));
});

test("seeded unknown retry and replay-resettle are rejected", () => {
  const unknown = evaluateTrace(loadFixture("reject/seeded-unknown-retry-settle.json"));
  assert.equal(unknown.ok, false);
  assert.ok(["unknown_retry_settle", "double_settle"].includes(unknown.code));
  assert.ok(unknown.violations.some((item) => item.code === "unknown_retry_settle"));

  const replay = evaluateTrace(loadFixture("reject/seeded-replay-resettle.json"));
  assert.equal(replay.ok, false);
  assert.equal(replay.code, "replay_resettle");
});

test("claims.ok cannot override a second settle", () => {
  const evaluated = evaluateTrace({
    id: "lie",
    claims: { ok: true, doubleSettle: false },
    settleCount: 2,
    attempts: [
      { seq: 1, phase: "first-paid", httpStatus: 200, settleDelta: 1, markerBeforeSettle: true, hasPaymentResponse: true },
      { seq: 2, phase: "retry", httpStatus: 200, settleDelta: 1, markerBeforeSettle: true, hasPaymentResponse: true },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "double_settle");
  assert.equal(evaluated.claimsRejected, true);
});

test("replay hit with settleDelta is replay_resettle", () => {
  const evaluated = evaluateTrace({
    attempts: [
      { seq: 1, phase: "first-paid", settleDelta: 1, markerBeforeSettle: true, httpStatus: 200, hasPaymentResponse: true },
      { seq: 2, phase: "retry", replay: "hit", settleDelta: 1, markerBeforeSettle: true, httpStatus: 200, hasPaymentResponse: true },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "replay_resettle");
});

test("missing possible-spend marker fails closed", () => {
  const evaluated = evaluateTrace({
    attempts: [
      { seq: 1, phase: "first-paid", settleDelta: 1, markerBeforeSettle: false, httpStatus: 200, hasPaymentResponse: true },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "marker_missing");
});

test("unpaid 402 that settles is rejected", () => {
  const evaluated = evaluateTrace({
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, settleDelta: 1, markerBeforeSettle: true, paymentPresent: false },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "unpaid_settle");
});

test("live facilitator URL is refused", () => {
  const evaluated = evaluateTrace({
    boundary: { facilitatorUrl: "https://facilitator.xpay.sh" },
    settleCount: 1,
    attempts: [
      { seq: 1, phase: "first-paid", settleDelta: 1, markerBeforeSettle: true, httpStatus: 200, hasPaymentResponse: true },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "live_facilitator");
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 5);
  assert.equal(classifyFixture(loadFixture("reject/seeded-double-settle.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/replay-after-success.json")).verdict, "pass");
});
