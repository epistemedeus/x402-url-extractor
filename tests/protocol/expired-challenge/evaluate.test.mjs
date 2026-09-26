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
    assert.equal(evaluated.ok, true, `${entry.id}: ${evaluated.code} ${JSON.stringify(evaluated.violations)}`);
    assert.equal(evaluated.code, "guard-holds");
    assert.equal(evaluated.expiredAccepted, false);
    assert.equal(evaluated.boundary.paymentSent, false);
  }
});

test("seeded expired-accepted is rejected as expired_challenge_accepted", () => {
  const fixture = loadFixture("reject/seeded-expired-accepted.json");
  const evaluated = evaluateTrace(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "expired_challenge_accepted");
  assert.equal(evaluated.expiredAccepted, true);
  assert.equal(evaluated.settleCount, 1);
  assert.equal(evaluated.claimsRejected, true);
  assert.ok(evaluated.violations.some((item) => item.code === "seeded_lie_expired_ok"));
});

test("seeded unbounded timeout and not-yet-valid are rejected", () => {
  const unbounded = evaluateTrace(loadFixture("reject/seeded-unbounded-timeout.json"));
  assert.equal(unbounded.ok, false);
  assert.equal(unbounded.code, "unbounded_timeout");

  const notYet = evaluateTrace(loadFixture("reject/seeded-not-yet-valid-accepted.json"));
  assert.equal(notYet.ok, false);
  assert.equal(notYet.code, "not_yet_valid_accepted");
});

test("claims.ok cannot override an expired delivery", () => {
  const evaluated = evaluateTrace({
    id: "lie",
    nowSec: 1_700_000_000,
    claims: { ok: true, expiredRejected: true },
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, maxTimeoutSeconds: 300, settleDelta: 0 },
      {
        seq: 2,
        phase: "expired-payload",
        httpStatus: 200,
        paymentPresent: true,
        validAfter: "0",
        validBefore: "1699999999",
        observedAtSec: 1_700_000_000,
        settleDelta: 1,
        hasPaymentResponse: true,
      },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "expired_challenge_accepted");
  assert.equal(evaluated.claimsRejected, true);
});

test("live facilitator URL is refused", () => {
  const evaluated = evaluateTrace({
    boundary: { facilitatorUrl: "https://facilitator.xpay.sh" },
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, maxTimeoutSeconds: 300, settleDelta: 0 },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "live_facilitator");
});

test("unpaid 402 that settles is rejected", () => {
  const evaluated = evaluateTrace({
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, maxTimeoutSeconds: 300, settleDelta: 1 },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "unpaid_settle");
});

test("missing validBefore on a delivered attempt fails closed", () => {
  const evaluated = evaluateTrace({
    nowSec: 1_700_000_000,
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, maxTimeoutSeconds: 300, settleDelta: 0 },
      { seq: 2, phase: "paid", httpStatus: 200, paymentPresent: true, settleDelta: 1, hasPaymentResponse: true },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "missing_validity");
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 8);
  assert.equal(classifyFixture(loadFixture("reject/seeded-expired-accepted.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/expired-payload-rejected.json")).verdict, "pass");
});
