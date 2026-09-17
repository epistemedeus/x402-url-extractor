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

test("pass traces hold the wrong-network guard", () => {
  for (const entry of loadFixtures("pass")) {
    const evaluated = evaluateTrace(entry.fixture);
    assert.equal(evaluated.ok, true, `${entry.id}: ${evaluated.code} ${JSON.stringify(evaluated.violations)}`);
    assert.equal(evaluated.code, "wrong-network-holds");
    assert.equal(evaluated.boundary.paymentSent, false);
    assert.equal(evaluated.mismatchAccepted, 0);
  }
});

test("seeded wrong-network acceptance is rejected as wrong_network_accepted", () => {
  const fixture = loadFixture("reject/seeded-wrong-network-accepted.json");
  const evaluated = evaluateTrace(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "wrong_network_accepted");
  assert.equal(evaluated.settleCount, 1);
  assert.equal(evaluated.mismatchAccepted, 1);
  assert.equal(evaluated.claimsRejected, true);
  assert.ok(evaluated.violations.some((item) => item.code === "wrong_network_settle"));
  assert.ok(evaluated.violations.some((item) => item.code === "seeded_lie_network_match"));
});

test("seeded settle and verify on a mismatch are rejected", () => {
  const settle = evaluateTrace(loadFixture("reject/seeded-wrong-network-settle.json"));
  assert.equal(settle.ok, false);
  assert.equal(settle.code, "wrong_network_settle");

  const verify = evaluateTrace(loadFixture("reject/seeded-wrong-network-verify.json"));
  assert.equal(verify.ok, false);
  assert.equal(verify.code, "wrong_network_verify");
});

test("claims.ok cannot override a sepolia payload that returned 200", () => {
  const evaluated = evaluateTrace({
    id: "lie",
    offeredNetwork: "eip155:8453",
    claims: { ok: true, networkMatch: true },
    settleCount: 1,
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, settleDelta: 0, paymentPresent: false, offeredNetwork: "eip155:8453" },
      {
        seq: 2,
        phase: "wrong-network-sepolia",
        httpStatus: 200,
        settleDelta: 1,
        verifyDelta: 1,
        hasPaymentResponse: true,
        paymentPresent: true,
        payloadNetwork: "eip155:84532",
        offeredNetwork: "eip155:8453",
      },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "wrong_network_accepted");
  assert.equal(evaluated.claimsRejected, true);
});

test("matching advertised network is allowed to settle once", () => {
  const evaluated = evaluateTrace({
    offeredNetwork: "eip155:8453",
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, settleDelta: 0, paymentPresent: false, offeredNetwork: "eip155:8453" },
      {
        seq: 2,
        phase: "matching",
        role: "matching",
        httpStatus: 200,
        settleDelta: 1,
        verifyDelta: 1,
        hasPaymentResponse: true,
        paymentPresent: true,
        payloadNetwork: "eip155:8453",
        offeredNetwork: "eip155:8453",
      },
    ],
  });
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.violations));
  assert.equal(evaluated.settleCount, 1);
  assert.equal(evaluated.mismatchAttempts, 0);
});

test("live facilitator URL is refused", () => {
  const evaluated = evaluateTrace({
    offeredNetwork: "eip155:8453",
    boundary: { facilitatorUrl: "https://facilitator.xpay.sh" },
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, settleDelta: 0, paymentPresent: false, offeredNetwork: "eip155:8453" },
      {
        seq: 2,
        phase: "wrong-network-sepolia",
        httpStatus: 402,
        settleDelta: 0,
        paymentPresent: true,
        payloadNetwork: "eip155:84532",
        offeredNetwork: "eip155:8453",
      },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "live_facilitator");
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 5);
  assert.equal(classifyFixture(loadFixture("reject/seeded-wrong-network-accepted.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/wrong-network-rejected.json")).verdict, "pass");
});
