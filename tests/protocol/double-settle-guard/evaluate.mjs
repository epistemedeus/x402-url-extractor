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

function replayFlag(attempt) {
  const value = attempt?.replay;
  if (value == null || value === false) return null;
  return String(value).toLowerCase();
}

function violation(code, message, extra = {}) {
  return { code, message, ...extra };
}

/**
 * Evaluate one payment-identity settle trace.
 * The guard holds iff facilitator /settle ran at most once and retries did
 * not create a replacement settlement.
 */
export function evaluateTrace(trace = {}) {
  const violations = [];
  const attempts = attemptsOf(trace);
  const settleFromAttempts = attempts.reduce((sum, attempt) => sum + numberOrZero(attempt.settleDelta), 0);
  const declaredSettle = trace.settleCount == null ? settleFromAttempts : numberOrZero(trace.settleCount);
  const settleCount = Math.max(settleFromAttempts, declaredSettle);
  const boundary = isRecord(trace.boundary) ? trace.boundary : {};
  const claims = isRecord(trace.claims) ? trace.claims : {};

  if (boundary.paymentSent === true) {
    violations.push(violation("payment_sent", "trace sent a live payment; double-settle-guard fixtures must not pay"));
  }
  if (boundary.liveFacilitator === true || (boundary.facilitatorUrl && !loopbackUrl(boundary.facilitatorUrl))) {
    violations.push(violation(
      "live_facilitator",
      "trace used a non-loopback facilitator; this suite never settles on xpay/CDP",
    ));
  }
  if (trace.settleCount != null && settleFromAttempts !== declaredSettle && attempts.length > 0) {
    violations.push(violation(
      "settle_count_inconsistent",
      `declared settleCount ${declaredSettle} does not match attempt settleDelta sum ${settleFromAttempts}`,
    ));
  }

  let settled = false;
  let unsuccessfulSettle = false;
  const transactions = new Set();

  for (const attempt of attempts) {
    const settleDelta = numberOrZero(attempt.settleDelta);
    const replay = replayFlag(attempt);
    const unpaid = attempt.phase === "unpaid" || attempt.paymentPresent === false;
    const success = Number(attempt.httpStatus) >= 200
      && Number(attempt.httpStatus) < 300
      && attempt.hasPaymentResponse === true;

    if (unpaid && settleDelta > 0) {
      violations.push(violation("unpaid_settle", "unpaid 402 must not call facilitator settle", { seq: attempt.seq }));
    }
    if (replay === "hit" && settleDelta > 0) {
      violations.push(violation(
        "replay_resettle",
        "x-payment-replay hit must not call facilitator settle again",
        { seq: attempt.seq },
      ));
    }
    if (attempt.newSettlementAttempt === true && settleDelta <= 0) {
      violations.push(violation(
        "replacement_settlement_claimed",
        "retry claimed newSettlementAttempt without a first-and-only settle",
        { seq: attempt.seq },
      ));
    }
    if (settleDelta > 0 && attempt.markerBeforeSettle !== true) {
      violations.push(violation(
        "marker_missing",
        "possible-spend marker must be durable before facilitator settle",
        { seq: attempt.seq },
      ));
    }
    if (settleDelta > 0 && settled) {
      violations.push(violation(
        "double_settle",
        "facilitator settle was invoked again for the same payment identity",
        { seq: attempt.seq },
      ));
    }
    if (settleDelta > 0 && unsuccessfulSettle) {
      violations.push(violation(
        "unknown_retry_settle",
        "unknown settlement was retried instead of quarantined",
        { seq: attempt.seq },
      ));
    }
    if (typeof attempt.transaction === "string" && /^0x[0-9a-fA-F]{64}$/.test(attempt.transaction)) {
      transactions.add(attempt.transaction.toLowerCase());
    }
    if (settleDelta > 0) {
      settled = true;
      if (!success) unsuccessfulSettle = true;
    }
  }

  if (settleCount > 1) {
    if (!violations.some((item) => item.code === "double_settle" || item.code === "unknown_retry_settle" || item.code === "replay_resettle")) {
      violations.push(violation(
        "double_settle",
        `facilitator settle count is ${settleCount}; the guard allows at most one settle per payment identity`,
      ));
    }
  }
  if (transactions.size > 1) {
    violations.push(violation(
      "distinct_settlement_transactions",
      "trace carries more than one settlement transaction hash for one payment identity",
      { transactions: [...transactions] },
    ));
  }
  if (claims.ok === true && settleCount > 1) {
    violations.push(violation(
      "seeded_lie_single_settle",
      "product claimed ok/single-settle while the trace shows more than one facilitator settle",
    ));
  }
  if (claims.doubleSettle === false && settleCount > 1) {
    violations.push(violation(
      "seeded_lie_single_settle",
      "product claimed doubleSettle:false while settleCount > 1",
    ));
  }

  const primary = violations[0];
  const ok = violations.length === 0 && (attempts.length > 0 || settleCount <= 1) && settleCount <= 1;
  return {
    ok: ok && settleCount <= 1 && violations.length === 0,
    code: violations.length === 0 ? "guard-holds" : primary.code,
    id: trace.id ?? null,
    expect: trace.expect ?? null,
    rejectCode: trace.rejectCode ?? null,
    settleCount,
    verifyCount: numberOrZero(trace.verifyCount),
    violations,
    claimsRejected: claims.ok === true && violations.length > 0,
    boundary: {
      paymentSent: boundary.paymentSent === true,
      liveFacilitator: boundary.liveFacilitator === true,
      checkoutMutated: boundary.checkoutMutated === true,
      published: boundary.published === true,
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
      settleCount: evaluated.settleCount,
      verifyCount: evaluated.verifyCount,
      violations: evaluated.violations,
      attempts: scenario.attempts,
      markerBeforeSettle: scenario.markerBeforeSettle ?? null,
      origin: scenario.origin ?? null,
    };
  });
  const failed = rows.filter((row) => !row.ok);
  const settleCounts = rows.map((row) => row.settleCount);
  const paymentSent = scenarios.some((scenario) => scenario.boundary?.paymentSent === true);
  return {
    ok: failed.length === 0 && rows.length > 0 && !paymentSent && settleCounts.every((count) => count <= 1),
    code: failed[0]?.code ?? (rows.length ? "guard-holds" : "no_scenarios"),
    mode: "cold",
    artifact: "server.js",
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed: failed.map((row) => ({ id: row.id, code: row.code, violations: row.violations })),
    settleCounts,
    paymentSent,
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
