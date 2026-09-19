import { evaluateColdSuite, evaluateFixtureCorpus, evaluateTrace } from "./evaluate.mjs";
import { numberAttempts, traceBoundary, withMerchant } from "./merchant.mjs";
import {
  ETHEREUM,
  LEGACY_BASE,
  loadFixtures,
  loadJson,
  SEEDED_WRONG_NETWORK,
  SEPOLIA,
  SEPOLIA_USDC,
  SOLANA,
} from "./paths.mjs";

function finishTrace(session, { id, paymentIdentity, attempts, expect = "pass", offeredNetwork }) {
  const numbered = numberAttempts(attempts);
  const settleCount = numbered.reduce((sum, attempt) => sum + Number(attempt.settleDelta || 0), 0);
  const verifyCount = numbered.reduce((sum, attempt) => sum + Number(attempt.verifyDelta || 0), 0);
  return {
    id,
    expect,
    rail: "x402",
    route: session.route,
    origin: session.origin(),
    offeredNetwork: offeredNetwork ?? session.network,
    paymentIdentity: paymentIdentity ?? null,
    attempts: numbered,
    settleCount,
    verifyCount,
    boundary: traceBoundary(session),
  };
}

async function mismatchAttempt(session, phase, paymentId, patch, fields = {}) {
  const credential = await session.credential(paymentId, patch);
  return session.recordAttempt(phase, credential.headers, {
    payloadNetwork: credential.payloadNetwork,
    fields,
  });
}

export async function runWrongNetworkMatrix() {
  return withMerchant(async (session) => {
    const unpaid = await session.recordAttempt("unpaid");
    const sepolia = await mismatchAttempt(
      session,
      "wrong-network-sepolia",
      "wrongnet_sepolia",
      { network: SEPOLIA, asset: SEPOLIA_USDC, extra: { name: "USDC", version: "2" } },
    );
    const ethereum = await mismatchAttempt(
      session,
      "wrong-network-ethereum",
      "wrongnet_eth",
      { network: ETHEREUM },
    );
    const solana = await mismatchAttempt(
      session,
      "wrong-network-solana",
      "wrongnet_sol",
      { network: SOLANA, asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
    );
    const fieldOnly = await mismatchAttempt(
      session,
      "wrong-network-field-only",
      "wrongnet_field",
      { network: SEPOLIA },
    );
    const legacy = await mismatchAttempt(
      session,
      "wrong-network-legacy-base",
      "wrongnet_legacy",
      { network: LEGACY_BASE },
    );
    const empty = await mismatchAttempt(
      session,
      "wrong-network-empty",
      "wrongnet_empty",
      { network: "" },
    );
    return finishTrace(session, {
      id: "x402-wrong-network-matrix",
      offeredNetwork: unpaid.offeredNetwork,
      attempts: [unpaid, sepolia, ethereum, solana, fieldOnly, legacy, empty],
    });
  });
}

export async function runMatchingControl() {
  return withMerchant(async (session) => {
    const unpaid = await session.recordAttempt("unpaid");
    const credential = await session.credential("wrongnet_match_ok");
    const matching = await session.recordAttempt("matching", credential.headers, {
      payloadNetwork: credential.payloadNetwork,
      fields: { role: "matching" },
    });
    return finishTrace(session, {
      id: "x402-matching-network-control",
      offeredNetwork: unpaid.offeredNetwork,
      paymentIdentity: credential.paymentIdentity,
      attempts: [unpaid, matching],
    });
  });
}

export async function runColdSuite() {
  const scenarios = [
    await runWrongNetworkMatrix(),
    await runMatchingControl(),
  ];
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

export function runSeededFailure(fixturePath = SEEDED_WRONG_NETWORK) {
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
