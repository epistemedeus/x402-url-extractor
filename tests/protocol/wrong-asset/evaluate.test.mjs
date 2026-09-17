import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyAsset, classifyFixture, evaluateTrace, evaluateFixtureCorpus } from "./evaluate.mjs";
import {
  BASE_WETH,
  CANONICAL_BASE_USDC,
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
    assert.equal(evaluated.boundary.paymentSent, false);
    if (entry.fixture.kind === "canonical-control") {
      assert.equal(evaluated.settleCount, 1);
      assert.equal(evaluated.asset.wrong, false);
    } else {
      assert.equal(evaluated.settleCount, 0);
      assert.equal(evaluated.asset.wrong, true);
    }
  }
});

test("seeded wrong-asset settle is rejected as wrong_asset_settled", () => {
  const fixture = loadFixture("reject/seeded-wrong-asset-settled.json");
  const evaluated = evaluateTrace(fixture);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "wrong_asset_settled");
  assert.equal(evaluated.settleCount, 1);
  assert.equal(evaluated.claimsRejected, true);
  assert.equal(evaluated.asset.payloadAsset, BASE_WETH.toLowerCase());
  assert.equal(evaluated.asset.advertisedAsset, CANONICAL_BASE_USDC.toLowerCase());
  assert.ok(evaluated.violations.some((item) => item.code === "seeded_lie_wrong_asset_ok"));
  assert.ok(evaluated.violations.some((item) => item.code === "wrong_asset_delivered"));
});

test("seeded native ETH and EIP-712 domain settles are rejected", () => {
  const eth = evaluateTrace(loadFixture("reject/seeded-wrong-asset-claimed-ok.json"));
  assert.equal(eth.ok, false);
  assert.equal(eth.code, "wrong_asset_settled");

  const domain = evaluateTrace(loadFixture("reject/seeded-eip712-domain-settled.json"));
  assert.equal(domain.ok, false);
  assert.equal(domain.asset.nameWrong, true);
  assert.ok(domain.violations.some((item) => item.code === "wrong_asset_settled"));
});

test("claims.ok cannot override a wrong-asset settle", () => {
  const evaluated = evaluateTrace({
    id: "lie",
    kind: "wrong-asset",
    claims: { ok: true, settled: true },
    advertisedAsset: CANONICAL_BASE_USDC,
    payloadAsset: BASE_WETH,
    settleCount: 1,
    attempts: [
      {
        seq: 1,
        phase: "paid",
        httpStatus: 200,
        settleDelta: 1,
        hasPaymentResponse: true,
        paymentPresent: true,
        payloadAsset: BASE_WETH,
      },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "wrong_asset_settled");
  assert.equal(evaluated.claimsRejected, true);
});

test("canonical control that does not settle fails closed", () => {
  const evaluated = evaluateTrace({
    kind: "canonical-control",
    mustSettle: true,
    advertisedAsset: CANONICAL_BASE_USDC,
    payloadAsset: CANONICAL_BASE_USDC,
    payloadAssetName: "USD Coin",
    payloadAssetVersion: "2",
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, settleDelta: 0, paymentPresent: false },
      {
        seq: 2,
        phase: "paid",
        httpStatus: 402,
        settleDelta: 0,
        paymentPresent: true,
        payloadAsset: CANONICAL_BASE_USDC,
      },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "control_did_not_settle");
});

test("unpaid 402 that settles is rejected", () => {
  const evaluated = evaluateTrace({
    advertisedAsset: CANONICAL_BASE_USDC,
    payloadAsset: CANONICAL_BASE_USDC,
    attempts: [
      { seq: 1, phase: "unpaid", httpStatus: 402, settleDelta: 1, paymentPresent: false },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "unpaid_settle");
});

test("live facilitator URL is refused", () => {
  const evaluated = evaluateTrace({
    boundary: { facilitatorUrl: "https://facilitator.xpay.sh" },
    advertisedAsset: CANONICAL_BASE_USDC,
    payloadAsset: BASE_WETH,
    settleCount: 0,
    attempts: [
      { seq: 1, phase: "paid", settleDelta: 0, httpStatus: 402, paymentPresent: true, payloadAsset: BASE_WETH },
    ],
  });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.code, "live_facilitator");
});

test("paymentSent and neoTouched fail closed", () => {
  const paid = evaluateTrace({
    boundary: { paymentSent: true, facilitatorUrl: "http://127.0.0.1:9" },
    advertisedAsset: CANONICAL_BASE_USDC,
    payloadAsset: BASE_WETH,
    attempts: [
      { seq: 1, phase: "paid", settleDelta: 0, httpStatus: 402, paymentPresent: true, payloadAsset: BASE_WETH },
    ],
  });
  assert.equal(paid.ok, false);
  assert.equal(paid.code, "payment_sent");

  const neo = evaluateTrace({
    boundary: { neoTouched: true, facilitatorUrl: "http://127.0.0.1:9" },
    advertisedAsset: CANONICAL_BASE_USDC,
    payloadAsset: BASE_WETH,
    attempts: [
      { seq: 1, phase: "paid", settleDelta: 0, httpStatus: 402, paymentPresent: true, payloadAsset: BASE_WETH },
    ],
  });
  assert.equal(neo.ok, false);
  assert.equal(neo.code, "neo_touched");
});

test("classifyAsset treats checksum-equivalent USDC as canonical", () => {
  const classified = classifyAsset({
    advertisedAsset: CANONICAL_BASE_USDC,
    payloadAsset: CANONICAL_BASE_USDC.toLowerCase(),
    payloadAssetName: "USD Coin",
    payloadAssetVersion: "2",
  });
  assert.equal(classified.wrong, false);
  assert.equal(classified.addressWrong, false);
});

test("classifyFixture matches expect for the on-disk corpus", () => {
  const report = evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
  assert.equal(report.ok, true, JSON.stringify(report.failed));
  assert.equal(report.counted, 7);
  assert.equal(classifyFixture(loadFixture("reject/seeded-wrong-asset-settled.json")).verdict, "rejected");
  assert.equal(classifyFixture(loadFixture("pass/wrong-erc20-never-settles.json")).verdict, "pass");
});
