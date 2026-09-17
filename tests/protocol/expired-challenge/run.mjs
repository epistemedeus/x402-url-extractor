import { evaluateColdSuite, evaluateFixtureCorpus, evaluateTrace } from "./evaluate.mjs";
import { numberAttempts, traceBoundary, withMerchant } from "./merchant.mjs";
import { loadFixtures, loadJson, SEEDED_EXPIRED_ACCEPTED } from "./paths.mjs";
import { MAX_TIMEOUT_SECONDS } from "./window.mjs";

function finishTrace(session, {
  id,
  paymentIdentity,
  attempts,
  expect = "pass",
  requirePaidDelivery = false,
}) {
  const numbered = numberAttempts(attempts.map((attempt) => {
    const { accepted, ...rest } = attempt;
    return rest;
  }));
  const settleCount = numbered.reduce((sum, attempt) => sum + Number(attempt.settleDelta || 0), 0);
  const verifyCount = numbered.reduce((sum, attempt) => sum + Number(attempt.verifyDelta || 0), 0);
  const unpaid = numbered.find((attempt) => attempt.phase === "unpaid");
  return {
    id,
    expect,
    rail: "x402",
    route: session.route,
    origin: session.origin(),
    nowSec: session.nowSec(),
    maxTimeoutSeconds: unpaid?.maxTimeoutSeconds ?? null,
    paymentIdentity: paymentIdentity ?? null,
    attempts: numbered,
    settleCount,
    verifyCount,
    requirePaidDelivery,
    boundary: traceBoundary(session),
  };
}

export async function runUnpaidBoundedTimeout() {
  return withMerchant({}, async (session) => {
    const { attempt } = await session.unpaidChallenge();
    return finishTrace(session, {
      id: "x402-unpaid-bounded-timeout",
      attempts: [attempt],
    });
  });
}

export async function runExpiredPayloadRejected() {
  return withMerchant({}, async (session) => {
    const { attempt: unpaid, accepted } = await session.unpaidChallenge();
    const now = session.nowSec();
    const cred = session.credential({
      paymentId: "expired_challenge_past_vb",
      accepted,
      validAfter: "0",
      validBefore: String(now - 1),
    });
    const expired = await session.recordAttempt("expired-payload", cred.headers, {
      authorization: cred.authorization,
      validAfter: cred.authorization.validAfter,
      validBefore: cred.authorization.validBefore,
    });
    return finishTrace(session, {
      id: "x402-expired-payload-rejected",
      paymentIdentity: cred.paymentIdentity,
      attempts: [unpaid, expired],
    });
  });
}

export async function runNotYetValidRejected() {
  return withMerchant({}, async (session) => {
    const { attempt: unpaid, accepted } = await session.unpaidChallenge();
    const now = session.nowSec();
    const cred = session.credential({
      paymentId: "expired_challenge_future_va",
      accepted,
      validAfter: String(now + 3_600),
      validBefore: String(now + 3_600 + MAX_TIMEOUT_SECONDS),
    });
    const notYet = await session.recordAttempt("not-yet-valid", cred.headers, {
      authorization: cred.authorization,
      validAfter: cred.authorization.validAfter,
      validBefore: cred.authorization.validBefore,
    });
    return finishTrace(session, {
      id: "x402-not-yet-valid-rejected",
      paymentIdentity: cred.paymentIdentity,
      attempts: [unpaid, notYet],
    });
  });
}

export async function runFreshWithinWindow() {
  return withMerchant({}, async (session) => {
    const { attempt: unpaid, accepted } = await session.unpaidChallenge();
    const now = session.nowSec();
    const cred = session.credential({
      paymentId: "expired_challenge_fresh_ok",
      accepted,
      validAfter: "0",
      validBefore: String(now + MAX_TIMEOUT_SECONDS),
    });
    const fresh = await session.recordAttempt("fresh", cred.headers, {
      authorization: cred.authorization,
      validAfter: cred.authorization.validAfter,
      validBefore: cred.authorization.validBefore,
    });
    return finishTrace(session, {
      id: "x402-fresh-within-window",
      paymentIdentity: cred.paymentIdentity,
      attempts: [unpaid, fresh],
      requirePaidDelivery: true,
    });
  });
}

export async function runColdSuite() {
  const scenarios = [
    await runUnpaidBoundedTimeout(),
    await runExpiredPayloadRejected(),
    await runNotYetValidRejected(),
    await runFreshWithinWindow(),
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

export function runSeededFailure(fixturePath = SEEDED_EXPIRED_ACCEPTED) {
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
