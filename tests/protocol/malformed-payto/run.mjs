import { evaluateColdSuite, evaluateFixtureCorpus, evaluateTrace } from "./evaluate.mjs";
import { numberAttempts, traceBoundary, withMerchant } from "./merchant.mjs";
import { loadFixtures, loadJson, SEEDED_MALFORMED_PAYTO_ACCEPTED } from "./paths.mjs";

function finishTrace(session, {
  id,
  paymentIdentity,
  attempts,
  expect = "pass",
  requirePaidDelivery = false,
  payTo = null,
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
    payTo: payTo ?? unpaid?.payTo ?? unpaid?.quotedPayTo ?? null,
    paymentIdentity: paymentIdentity ?? null,
    attempts: numbered,
    settleCount,
    verifyCount,
    requirePaidDelivery,
    boundary: traceBoundary(session),
  };
}

export async function runUnpaidWellformedPayTo() {
  return withMerchant({}, async (session) => {
    const { attempt } = await session.unpaidChallenge();
    return finishTrace(session, {
      id: "x402-unpaid-wellformed-payto",
      attempts: [attempt],
      payTo: attempt.payTo,
    });
  });
}

export async function runMalformedAuthorizationToRejected() {
  return withMerchant({}, async (session) => {
    const { attempt: unpaid, accepted } = await session.unpaidChallenge();
    const cred = session.credential({
      paymentId: "malformed_payto_to_bad1",
      accepted,
      authorizationTo: "not-an-address",
    });
    const malformed = await session.recordAttempt("malformed-to", cred.headers, {
      authorization: cred.authorization,
      quotedPayTo: accepted.payTo,
      acceptedPayTo: accepted.payTo,
      authorizationTo: cred.authorizationTo,
      payTo: accepted.payTo,
    });
    return finishTrace(session, {
      id: "x402-malformed-to-rejected",
      paymentIdentity: cred.paymentIdentity,
      attempts: [unpaid, malformed],
      payTo: accepted.payTo,
    });
  });
}

export async function runMalformedAcceptedPayToRejected() {
  return withMerchant({}, async (session) => {
    const { attempt: unpaid, accepted } = await session.unpaidChallenge();
    const cred = session.credential({
      paymentId: "malformed_payto_acc_uri",
      accepted,
      acceptedPayTo: "payto://iban/DE89370400440532013000",
      authorizationTo: "payto://iban/DE89370400440532013000",
    });
    const malformed = await session.recordAttempt("malformed-accepted-payto", cred.headers, {
      authorization: cred.authorization,
      quotedPayTo: accepted.payTo,
      acceptedPayTo: cred.acceptedPayTo,
      authorizationTo: cred.authorizationTo,
      payTo: accepted.payTo,
    });
    return finishTrace(session, {
      id: "x402-malformed-accepted-payto-rejected",
      paymentIdentity: cred.paymentIdentity,
      attempts: [unpaid, malformed],
      payTo: accepted.payTo,
    });
  });
}

export async function runWellformedPayToDelivers() {
  return withMerchant({}, async (session) => {
    const { attempt: unpaid, accepted } = await session.unpaidChallenge();
    const cred = session.credential({
      paymentId: "malformed_payto_fresh_ok",
      accepted,
    });
    const fresh = await session.recordAttempt("fresh", cred.headers, {
      authorization: cred.authorization,
      quotedPayTo: accepted.payTo,
      acceptedPayTo: accepted.payTo,
      authorizationTo: accepted.payTo,
      payTo: accepted.payTo,
    });
    return finishTrace(session, {
      id: "x402-wellformed-payto-delivers",
      paymentIdentity: cred.paymentIdentity,
      attempts: [unpaid, fresh],
      requirePaidDelivery: true,
      payTo: accepted.payTo,
    });
  });
}

export async function runColdSuite() {
  const scenarios = [
    await runUnpaidWellformedPayTo(),
    await runMalformedAuthorizationToRejected(),
    await runMalformedAcceptedPayToRejected(),
    await runWellformedPayToDelivers(),
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

export function runSeededFailure(fixturePath = SEEDED_MALFORMED_PAYTO_ACCEPTED) {
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
