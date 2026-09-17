const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loopbackUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(String(value));
    return LOOPBACK.has(url.hostname);
  } catch {
    return false;
  }
}

function attemptsOf(trace) {
  return Array.isArray(trace?.attempts) ? trace.attempts.filter(isRecord) : [];
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function violation(code, message, extra = {}) {
  return { code, message, ...extra };
}

function advertisedNetwork(trace, attempts) {
  if (typeof trace?.offeredNetwork === "string" && trace.offeredNetwork) return trace.offeredNetwork;
  const unpaid = attempts.find((attempt) => attempt.phase === "unpaid" || attempt.paymentPresent === false);
  if (typeof unpaid?.offeredNetwork === "string" && unpaid.offeredNetwork) return unpaid.offeredNetwork;
  if (typeof attempts[0]?.offeredNetwork === "string" && attempts[0].offeredNetwork) {
    return attempts[0].offeredNetwork;
  }
  return "";
}

function payloadNetworkOf(attempt, offeredNetwork) {
  if (typeof attempt?.payloadNetwork === "string") return attempt.payloadNetwork;
  if (attempt?.paymentPresent === true) return offeredNetwork;
  return null;
}

function isMismatch(attempt, offeredNetwork) {
  if (attempt?.paymentPresent !== true) return false;
  const payloadNetwork = payloadNetworkOf(attempt, offeredNetwork);
  if (payloadNetwork == null || payloadNetwork === "") return true;
  return payloadNetwork !== offeredNetwork;
}

function isMatchingPayment(attempt, offeredNetwork) {
  if (attempt?.paymentPresent !== true) return false;
  if (!offeredNetwork) return false;
  return payloadNetworkOf(attempt, offeredNetwork) === offeredNetwork;
}

function successStatus(attempt) {
  const status = Number(attempt?.httpStatus);
  return status >= 200 && status < 300;
}

function serverErrorStatus(attempt) {
  const status = Number(attempt?.httpStatus);
  return status >= 500;
}

/**
 * Evaluate one x402 wrong-network trace.
 * A PAYMENT-SIGNATURE whose accepted.network is not the advertised route
 * network must not grant the resource, verify, or settle.
 */
export function evaluateTrace(trace = {}) {
  const violations = [];
  const attempts = attemptsOf(trace);
  const offeredNetwork = advertisedNetwork(trace, attempts);
  const claims = isRecord(trace.claims) ? trace.claims : {};
  const boundary = isRecord(trace.boundary) ? trace.boundary : {};
  const settleFromAttempts = attempts.reduce((sum, attempt) => sum + numberOrZero(attempt.settleDelta), 0);
  const verifyFromAttempts = attempts.reduce((sum, attempt) => sum + numberOrZero(attempt.verifyDelta), 0);
  const declaredSettle = trace.settleCount == null ? settleFromAttempts : numberOrZero(trace.settleCount);
  const declaredVerify = trace.verifyCount == null ? verifyFromAttempts : numberOrZero(trace.verifyCount);
  const settleCount = Math.max(settleFromAttempts, declaredSettle);
  const verifyCount = Math.max(verifyFromAttempts, declaredVerify);

  if (boundary.paymentSent === true) {
    violations.push(violation("payment_sent", "trace sent a live payment; wrong-network fixtures must not pay"));
  }
  if (boundary.liveFacilitator === true || (boundary.facilitatorUrl && !loopbackUrl(boundary.facilitatorUrl))) {
    violations.push(violation(
      "live_facilitator",
      "trace used a non-loopback facilitator; this suite never settles on xpay/CDP",
    ));
  }
  if (boundary.checkoutMutated === true) {
    violations.push(violation("checkout_mutated", "wrong-network suite must not mutate checkout"));
  }
  if (boundary.published === true) {
    violations.push(violation("published", "wrong-network suite must not publish"));
  }
  if (boundary.neoTouched === true) {
    violations.push(violation("neo_touched", "wrong-network suite must not touch neomorphic-io"));
  }

  if (!offeredNetwork) {
    violations.push(violation("missing_offered_network", "trace omitted the advertised PAYMENT-REQUIRED network"));
  }

  let mismatchAttempts = 0;
  let mismatchAccepted = 0;
  let matchingAttempts = 0;
  let matchingSettled = 0;

  for (const attempt of attempts) {
    const unpaid = attempt.phase === "unpaid" || attempt.paymentPresent === false;
    const settleDelta = numberOrZero(attempt.settleDelta);
    const verifyDelta = numberOrZero(attempt.verifyDelta);
    const payloadNetwork = payloadNetworkOf(attempt, offeredNetwork);

    if (unpaid && settleDelta > 0) {
      violations.push(violation("unpaid_settle", "unpaid 402 must not call facilitator settle", { seq: attempt.seq }));
    }
    if (unpaid && verifyDelta > 0) {
      violations.push(violation("unpaid_verify", "unpaid 402 must not call facilitator verify", { seq: attempt.seq }));
    }

    if (isMismatch(attempt, offeredNetwork)) {
      mismatchAttempts += 1;
      if (successStatus(attempt)) {
        mismatchAccepted += 1;
        violations.push(violation(
          "wrong_network_accepted",
          `PAYMENT-SIGNATURE network ${payloadNetwork} was accepted against advertised ${offeredNetwork}`,
          { seq: attempt.seq, payloadNetwork, offeredNetwork, httpStatus: attempt.httpStatus },
        ));
      }
      if (serverErrorStatus(attempt)) {
        violations.push(violation(
          "wrong_network_server_error",
          "wrong-network payload produced a 5xx instead of a protocol rejection",
          { seq: attempt.seq, httpStatus: attempt.httpStatus },
        ));
      }
      if (settleDelta > 0) {
        violations.push(violation(
          "wrong_network_settle",
          "wrong-network PAYMENT-SIGNATURE must not call facilitator settle",
          { seq: attempt.seq, payloadNetwork },
        ));
      }
      if (verifyDelta > 0) {
        violations.push(violation(
          "wrong_network_verify",
          "wrong-network PAYMENT-SIGNATURE must not call facilitator verify",
          { seq: attempt.seq, payloadNetwork },
        ));
      }
      if (attempt.hasPaymentResponse === true) {
        violations.push(violation(
          "wrong_network_settlement_header",
          "wrong-network response must not carry PAYMENT-RESPONSE",
          { seq: attempt.seq },
        ));
      }
      if (attempt.charged === true) {
        violations.push(violation(
          "wrong_network_charged",
          "wrong-network payload must not mark the request charged",
          { seq: attempt.seq },
        ));
      }
    }

    if (isMatchingPayment(attempt, offeredNetwork)) {
      matchingAttempts += 1;
      if (settleDelta > 0) matchingSettled += 1;
      if (attempt.phase === "matching" || attempt.role === "matching") {
        if (!successStatus(attempt)) {
          violations.push(violation(
            "matching_network_blocked",
            "matching advertised network was blocked; harness must still settle a correct PAYMENT-SIGNATURE",
            { seq: attempt.seq, httpStatus: attempt.httpStatus },
          ));
        }
      }
    }
  }

  if (trace.settleCount != null && settleFromAttempts !== declaredSettle && attempts.length > 0) {
    violations.push(violation(
      "settle_count_inconsistent",
      `declared settleCount ${declaredSettle} does not match attempt settleDelta sum ${settleFromAttempts}`,
    ));
  }

  if (claims.ok === true && mismatchAccepted > 0) {
    violations.push(violation(
      "seeded_lie_network_match",
      "product claimed ok while a wrong-network PAYMENT-SIGNATURE granted the resource",
    ));
  }
  if (claims.networkMatch === true && mismatchAccepted > 0) {
    violations.push(violation(
      "seeded_lie_network_match",
      "product claimed networkMatch:true while payload network differed from the advertised route",
    ));
  }
  if (claims.wrongNetworkRejected === true && mismatchAccepted > 0) {
    violations.push(violation(
      "seeded_lie_network_match",
      "product claimed wrong-network rejection while the resource was granted",
    ));
  }

  const primary = violations[0];
  const ok = violations.length === 0 && attempts.length > 0;
  return {
    ok,
    code: violations.length === 0 ? "wrong-network-holds" : primary.code,
    id: trace.id ?? null,
    expect: trace.expect ?? null,
    rejectCode: trace.rejectCode ?? null,
    offeredNetwork: offeredNetwork || null,
    settleCount,
    verifyCount,
    mismatchAttempts,
    mismatchAccepted,
    matchingAttempts,
    matchingSettled,
    violations,
    claimsRejected: Boolean(claims.ok === true && violations.length > 0),
    boundary: {
      paymentSent: boundary.paymentSent === true,
      liveFacilitator: boundary.liveFacilitator === true,
      checkoutMutated: boundary.checkoutMutated === true,
      published: boundary.published === true,
      neoTouched: boundary.neoTouched === true,
    },
  };
}

export function classifyFixture(fixture) {
  const evaluated = evaluateTrace(fixture);
  const expect = fixture?.expect;
  if (expect === "pass") {
    return {
      ...evaluated,
      classified: evaluated.ok,
      verdict: evaluated.ok ? "pass" : "fail",
    };
  }
  if (expect === "reject") {
    const codeOk = !fixture.rejectCode || evaluated.code === fixture.rejectCode
      || evaluated.violations.some((item) => item.code === fixture.rejectCode);
    const classified = evaluated.ok === false && codeOk;
    return {
      ...evaluated,
      classified,
      verdict: evaluated.ok ? "accepted" : "rejected",
      ok: classified,
    };
  }
  return {
    ...evaluated,
    classified: false,
    verdict: "malformed_fixture",
    ok: false,
    code: "malformed_fixture",
  };
}

export function evaluateColdSuite(scenarios = []) {
  const rows = scenarios.map((scenario) => {
    const evaluated = evaluateTrace(scenario);
    return {
      id: scenario.id,
      rail: scenario.rail ?? "x402",
      ok: evaluated.ok,
      code: evaluated.code,
      offeredNetwork: evaluated.offeredNetwork,
      settleCount: evaluated.settleCount,
      verifyCount: evaluated.verifyCount,
      mismatchAttempts: evaluated.mismatchAttempts,
      mismatchAccepted: evaluated.mismatchAccepted,
      matchingAttempts: evaluated.matchingAttempts,
      matchingSettled: evaluated.matchingSettled,
      violations: evaluated.violations,
      attempts: scenario.attempts,
      origin: scenario.origin ?? null,
    };
  });
  const failed = rows.filter((row) => !row.ok);
  const matrix = rows.find((row) => row.id === "x402-wrong-network-matrix");
  const matching = rows.find((row) => row.id === "x402-matching-network-control");
  const paymentSent = scenarios.some((scenario) => scenario.boundary?.paymentSent === true);
  const matrixOk = Boolean(matrix && matrix.ok && matrix.settleCount === 0 && matrix.verifyCount === 0 && matrix.mismatchAttempts > 0 && matrix.mismatchAccepted === 0);
  const matchingOk = Boolean(matching && matching.ok && matching.settleCount === 1 && matching.matchingSettled === 1);
  return {
    ok: failed.length === 0 && matrixOk && matchingOk && !paymentSent && rows.length > 0,
    code: failed[0]?.code ?? (matrixOk && matchingOk ? "wrong-network-holds" : "cold_incomplete"),
    mode: "cold",
    artifact: "server.js",
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed: failed.map((row) => ({ id: row.id, code: row.code, violations: row.violations })),
    settleCounts: rows.map((row) => row.settleCount),
    verifyCounts: rows.map((row) => row.verifyCount),
    paymentSent,
    offeredNetwork: matrix?.offeredNetwork ?? matching?.offeredNetwork ?? null,
    scenarios: rows,
  };
}

export function evaluateFixtureCorpus(passFixtures, rejectFixtures) {
  const pass = passFixtures.map((entry) => ({
    id: entry.id,
    path: entry.relativePath,
    expect: "pass",
    ...classifyFixture(entry.fixture),
  }));
  const reject = rejectFixtures.map((entry) => ({
    id: entry.id,
    path: entry.relativePath,
    expect: "reject",
    rejectCode: entry.rejectCode,
    ...classifyFixture(entry.fixture),
  }));
  const rows = [...pass, ...reject];
  const failed = rows.filter((row) => row.classified !== true);
  return {
    ok: failed.length === 0 && rows.length > 0,
    code: failed[0]?.code ?? "fixtures-match",
    counted: rows.length,
    passed: rows.filter((row) => row.classified).length,
    failed: failed.map((row) => ({
      id: row.id,
      path: row.path,
      expect: row.expect,
      code: row.code,
      verdict: row.verdict,
    })),
    rows,
  };
}
