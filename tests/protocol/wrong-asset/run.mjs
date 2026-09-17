import { evaluateColdSuite, evaluateFixtureCorpus, evaluateTrace } from "./evaluate.mjs";
import { numberAttempts, traceBoundary, withMerchant } from "./merchant.mjs";
import {
  BASE_SEPOLIA_USDC,
  BASE_WETH,
  CANONICAL_ASSET_NAME,
  CANONICAL_ASSET_VERSION,
  CANONICAL_BASE_USDC,
  loadFixtures,
  loadJson,
  NATIVE_ETH_SENTINEL,
  SEEDED_WRONG_ASSET,
} from "./paths.mjs";

function finishTrace(session, {
  id,
  kind,
  paymentIdentity,
  advertised,
  accepted,
  attempts,
  expect = "pass",
  mustSettle = false,
}) {
  const numbered = numberAttempts(attempts);
  const settleCount = numbered.reduce((sum, attempt) => sum + Number(attempt.settleDelta || 0), 0);
  const verifyCount = numbered.reduce((sum, attempt) => sum + Number(attempt.verifyDelta || 0), 0);
  return {
    id,
    expect,
    kind,
    mustSettle,
    rail: "x402",
    route: session.route,
    origin: session.origin(),
    advertisedAsset: advertised?.asset || CANONICAL_BASE_USDC,
    advertisedAssetName: advertised?.extra?.name || CANONICAL_ASSET_NAME,
    advertisedAssetVersion: advertised?.extra?.version || CANONICAL_ASSET_VERSION,
    advertisedNetwork: advertised?.network,
    payloadAsset: accepted?.asset || paymentIdentity?.asset || null,
    payloadAssetName: accepted?.extra?.name || paymentIdentity?.extra?.name || null,
    payloadAssetVersion: accepted?.extra?.version || paymentIdentity?.extra?.version || null,
    paymentIdentity,
    attempts: numbered,
    settleCount,
    verifyCount,
    boundary: traceBoundary(session),
  };
}

async function runScenario(session, {
  id,
  kind,
  paymentId,
  mutateAccepted = null,
  mustSettle = false,
}) {
  const unpaid = await session.recordAttempt("unpaid");
  const { headers, paymentIdentity, advertised, accepted } = await session.credential(paymentId, mutateAccepted);
  const paid = await session.recordAttempt("paid", headers, {
    payloadAsset: accepted.asset,
    payloadAssetName: accepted.extra?.name,
    payloadAssetVersion: accepted.extra?.version,
  });
  return finishTrace(session, {
    id,
    kind,
    paymentIdentity,
    advertised,
    accepted,
    attempts: [unpaid, paid],
    mustSettle,
  });
}

export async function runColdSuite() {
  const scenarios = await withMerchant(async (session) => {
    await session.challenge();
    return [
      await runScenario(session, {
        id: "x402-canonical-usdc-settles",
        kind: "canonical-control",
        paymentId: "wrongasset_canon_01",
        mustSettle: true,
      }),
      await runScenario(session, {
        id: "x402-wrong-erc20-never-settles",
        kind: "wrong-asset",
        paymentId: "wrongasset_weth_0001",
        mutateAccepted: (accepted) => {
          accepted.asset = BASE_WETH;
        },
      }),
      await runScenario(session, {
        id: "x402-sepolia-usdc-never-settles",
        kind: "wrong-asset",
        paymentId: "wrongasset_sep_usdc1",
        mutateAccepted: (accepted) => {
          accepted.asset = BASE_SEPOLIA_USDC;
        },
      }),
      await runScenario(session, {
        id: "x402-native-eth-never-settles",
        kind: "wrong-asset",
        paymentId: "wrongasset_eth_sent1",
        mutateAccepted: (accepted) => {
          accepted.asset = NATIVE_ETH_SENTINEL;
        },
      }),
      await runScenario(session, {
        id: "x402-wrong-eip712-name-never-settles",
        kind: "wrong-asset",
        paymentId: "wrongasset_eip712_01",
        mutateAccepted: (accepted) => {
          accepted.extra = { ...accepted.extra, name: "Wrapped Ether" };
        },
      }),
    ];
  });
  const report = evaluateColdSuite(scenarios);
  report.boundary = {
    paymentSent: false,
    liveFacilitator: false,
    checkoutMutated: false,
    published: false,
    neoTouched: false,
  };
  return report;
}

export function runSeededFailure(fixturePath = SEEDED_WRONG_ASSET) {
  const fixture = loadJson(fixturePath);
  const evaluated = evaluateTrace(fixture);
  return {
    ...evaluated,
    mode: "seeded-failure",
    fixture: fixturePath,
    id: fixture.id ?? evaluated.id,
    claims: fixture.claims ?? null,
    settleCount: evaluated.settleCount,
  };
}

export function runFixtureCorpus() {
  return evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
}
