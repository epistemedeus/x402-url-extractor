import { evaluateColdSuite, evaluateFixtureCorpus, evaluateTrace } from "./evaluate.mjs";
import { numberAttempts, traceBoundary, withMerchant } from "./merchant.mjs";
import { loadFixtures, loadJson, SEEDED_DOUBLE_SETTLE } from "./paths.mjs";

function finishTrace(session, { id, paymentIdentity, attempts, expect = "pass" }) {
  const numbered = numberAttempts(attempts);
  const settleCount = numbered.reduce((sum, attempt) => sum + Number(attempt.settleDelta || 0), 0);
  const verifyCount = numbered.reduce((sum, attempt) => sum + Number(attempt.verifyDelta || 0), 0);
  const settling = numbered.find((attempt) => attempt.settleDelta > 0);
  return {
    id,
    expect,
    rail: "x402",
    route: session.route,
    origin: session.origin(),
    paymentIdentity,
    attempts: numbered,
    settleCount,
    verifyCount,
    markerBeforeSettle: settling?.markerBeforeSettle ?? null,
    boundary: traceBoundary(session),
  };
}

export async function runSuccessReplayRestart() {
  return withMerchant({ unknown: false }, async (session) => {
    const unpaid = await session.recordAttempt("unpaid");
    const { headers, paymentIdentity } = await session.credential("dblsettle_guard_ok1");
    const first = await session.recordAttempt("first-paid", headers);
    const retry = await session.recordAttempt("retry", headers);
    await session.restart();
    const resumed = await session.recordAttempt("restart-retry", headers);
    return finishTrace(session, {
      id: "x402-success-replay-restart",
      paymentIdentity,
      attempts: [unpaid, first, retry, resumed],
    });
  });
}

export async function runUnknownQuarantine() {
  return withMerchant({ unknown: true }, async (session) => {
    const unpaid = await session.recordAttempt("unpaid");
    const { headers, paymentIdentity } = await session.credential("dblsettle_guard_unk1");
    const first = await session.recordAttempt("first-paid", headers);
    const retry = await session.recordAttempt("retry", headers);
    await session.restart();
    const resumed = await session.recordAttempt("restart-retry", headers);
    return finishTrace(session, {
      id: "x402-unknown-quarantine-restart",
      paymentIdentity,
      attempts: [unpaid, first, retry, resumed],
    });
  });
}

export async function runConcurrentTwin() {
  return withMerchant({ unknown: false }, async (session) => {
    const unpaid = await session.recordAttempt("unpaid");
    const { headers, paymentIdentity } = await session.credential("dblsettle_guard_twin");
    const before = session.snapshot();
    const responses = await Promise.all([
      session.request(headers),
      session.request(headers),
    ]);
    const after = session.snapshot();
    const settleDelta = after.settle - before.settle;
    const twins = [];
    for (const [index, response] of responses.entries()) {
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = null; }
      twins.push({
        phase: index === 0 ? "concurrent-a" : "concurrent-b",
        httpStatus: response.status,
        replay: response.headers.get("x-payment-replay"),
        idempotency: response.headers.get("x-payment-idempotency"),
        hasPaymentResponse: Boolean(
          response.headers.get("payment-response")
          || response.headers.get("x-payment-response"),
        ),
        newSettlementAttempt: body && Object.hasOwn(body, "newSettlementAttempt")
          ? body.newSettlementAttempt
          : null,
        charged: body && Object.hasOwn(body, "charged") ? body.charged : null,
        error: typeof body?.error === "string" ? body.error : null,
        // Attribute the observed settle increment to the first twin. If the
        // facilitator counted two, settleDelta is 2 and evaluateTrace fails.
        settleDelta: index === 0 ? settleDelta : 0,
        verifyDelta: index === 0 ? after.verify - before.verify : 0,
        markerBeforeSettle: index === 0 && settleDelta > 0
          ? session.facilitator.state.markerBeforeSettle
          : null,
        paymentPresent: true,
      });
    }
    return finishTrace(session, {
      id: "x402-concurrent-twin",
      paymentIdentity,
      attempts: [unpaid, ...twins],
    });
  });
}

export async function runColdSuite() {
  const scenarios = [
    await runSuccessReplayRestart(),
    await runUnknownQuarantine(),
    await runConcurrentTwin(),
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

export function runSeededFailure(fixturePath = SEEDED_DOUBLE_SETTLE) {
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
