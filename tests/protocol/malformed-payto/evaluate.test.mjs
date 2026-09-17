import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeReplayPayment } from "../../../idempotency-replay.mjs";
import { classifyFixture, evaluateTrace, evaluateFixtureCorpus } from "./evaluate.mjs";
import {
  FIXTURE_SCHEMA,
  MERCHANT_PAYTO,
  loadFixture,
  loadFixtures,
  loadManifest,
  listPassFixtureFiles,
  listRejectFixtureFiles,
} from "./paths.mjs";
import { classifyPayTo, isWellFormedPayTo } from "./payto.mjs";

test("manifest lists every pass and reject fixture", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, FIXTURE_SCHEMA);
  const listedPass = manifest.fixtures.filter((entry) => entry.expect === "pass").map((entry) => entry.path).sort();
  const listedReject = manifest.fixtures.filter((entry) => entry.expect === "reject").map((entry) => entry.path).sort();
  assert.deepEqual(listedPass, listPassFixtureFiles());
  assert.deepEqual(listedReject, listRejectFixtureFiles());
});

test("classifyPayTo accepts checksummed merchant payTo and rejects malformed forms", () => {
  assert.equal(isWellFormedPayTo(MERCHANT_PAYTO), true);
  assert.equal(classifyPayTo(MERCHANT_PAYTO).address, MERCHANT_PAYTO.toLowerCase());
  assert.equal(classifyPayTo("").status, "empty");
  assert.equal(classifyPayTo(null).status, "null");
  assert.equal(classifyPayTo("not-an-address").status, "no_prefix");
  assert.equal(classifyPayTo("merchant.eth").status, "ens");
  assert.equal(classifyPayTo("payto://iban/DE89370400440532013000").status, "payto_uri");
  assert.equal(classifyPayTo("https://example.com/pay").status, "url");
  assert.equal(classifyPayTo(" 0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee").status, "whitespace");
  assert.equal(classifyPayTo("0x8904dF3DE6DFEe6a7C8cc38619d2f17806213C").status, "wrong_length");
  assert.equal(classifyPayTo(`0x${"g".repeat(40)}`).status, "non_hex");
});

test("decodeReplayPayment fails closed when accepted.payTo is malformed", () => {
  const encode = (payTo) => Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "10000",
      payTo,
      maxTimeoutSeconds: 300,
    },
    payload: { authorization: { from: "0x1111111111111111111111111111111111111111" }, signature: "0xsig" },
    extensions: { "payment-identifier": { info: { id: "malformed_payto_replay1" } } },
  })).toString("base64");

  const ok = decodeReplayPayment({ "payment-signature": encode(MERCHANT_PAYTO) });
  assert.equal(ok.terms.payTo, MERCHANT_PAYTO.toLowerCase());
  assert.equal(decodeReplayPayment({ "payment-signature": encode("not-an-address") }), null);
  assert.equal(decodeReplayPayment({ "payment-signature": encode("") }), null);
  assert.equal(decodeReplayPayment({ "payment-signature": encode("payto://iban/DE89370400440532013000") }), null);
  assert.equal(decodeReplayPayment({ "payment-signature": encode("merchant.eth") }), null);
});

test("pass traces hold the guard", () => {
  for (const entry of loadFixtures("pass")) {
    const evaluated = evaluateTrace(entry.fixture);
    assert.equal(evaluated.ok, true, `${entry.id}: ${evaluated.code} ${JSON.stringify(evaluated.violations)}`);
    assert.equal(evaluated.code, "guard-holds");
    assert.equal(evaluated.malformedPayToAccepted, false);
    assert.equal(evaluated.boundary.paymentSent, false);
  }
});

test("seeded malformed-payto-accepted is rejected as malformed_payto_accepted", () => {
  const fixture = loadFixture("reject/seeded-malformed-payto-accepted.json");
  const evaluated = evaluateTrace(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "malformed_payto_accepted");
  assert.equal(evaluated.malformedPayToAccepted, true);
  assert.equal(evaluated.settleCount, 1);
  assert.equal(evaluated.claimsRejected, true);
  assert.ok(evaluated.violations.some((item) => item.code === "seeded_lie_malformed_payto_ok"));
});

test("seeded empty payTo and unpaid malformed quoted payTo are rejected", () => {
  const empty = evaluateTrace(loadFixture("reject/seeded-empty-payto-accepted.json"));
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "malformed_payto_accepted");

  const quoted = evaluateTrace(loadFixture("reject/seeded-unpaid-malformed-payto.json"));
  assert.equal(quoted.ok, false);
  assert.equal(quoted.code, "malformed_quoted_payto");
});

test("claims.ok cannot override a malformed payTo delivery", () => {
  const evaluated = evaluateTrace({
    id: "lie",
    claims: { ok: true, malformedPayToRejected: true },
    payTo: MERCHANT_PAYTO,
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, payTo: MERCHANT_PAYTO, settleDelta: 0 },
      {
        seq: 2,
        phase: "malformed-to",
        httpStatus: 200,
        paymentPresent: true,
        quotedPayTo: MERCHANT_PAYTO,
        authorizationTo: "not-an-address",
        acceptedPayTo: "not-an-address",
        settleDelta: 1,
        hasPaymentResponse: true,
      },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "malformed_payto_accepted");
  assert.equal(evaluated.claimsRejected, true);
});

test("live facilitator URL is refused", () => {
  const evaluated = evaluateTrace({
    boundary: { facilitatorUrl: "https://facilitator.xpay.sh" },
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, payTo: MERCHANT_PAYTO, settleDelta: 0 },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "live_facilitator");
});

test("unpaid 402 that settles is rejected", () => {
  const evaluated = evaluateTrace({
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, payTo: MERCHANT_PAYTO, settleDelta: 1 },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "unpaid_settle");
});

test("missing payTo on a delivered attempt fails closed", () => {
  const evaluated = evaluateTrace({
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, paymentPresent: false, payTo: MERCHANT_PAYTO, settleDelta: 0 },
      { seq: 2, phase: "paid", httpStatus: 200, paymentPresent: true, settleDelta: 1, hasPaymentResponse: true },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "missing_payto");
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 8);
  assert.equal(classifyFixture(loadFixture("reject/seeded-malformed-payto-accepted.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/malformed-to-rejected.json")).verdict, "pass");
});
