import { classifyWindow, isBoundedTimeout, MAX_TIMEOUT_SECONDS } from "./window.mjs";

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

function looksDelivered(attempt) {
  const status = Number(attempt.httpStatus);
  if (numberOrZero(attempt.settleDelta) > 0) return true;
  if (attempt.charged === true) return true;
  if (attempt.hasPaymentResponse === true && status >= 200 && status < 300) return true;
  if (Number.isFinite(status) && status >= 200 && status < 300) return true;
  return false;
}

function observedAt(attempt, fallback) {
  const n = Number(attempt.observedAtSec ?? attempt.nowSec ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function timeoutOf(attempt, fallback) {
  const n = Number(attempt.maxTimeoutSeconds ?? fallback);
  return Number.isSafeInteger(n) ? n : fallback;
}

/**
 * Evaluate one x402 challenge/payload expiry trace.
 * Holds iff bounded unpaid 402 and expired / not-yet-valid / unbounded
 * payloads are not delivered or settled.
 */
export function evaluateTrace(trace = {}) {
  const violations = [];
  const attempts = attemptsOf(trace);
  const settleFromAttempts = attempts.reduce((sum, attempt) => sum + numberOrZero(attempt.settleDelta), 0);
  const declaredSettle = trace.settleCount == null ? settleFromAttempts : numberOrZero(trace.settleCount);
  const settleCount = Math.max(settleFromAttempts, declaredSettle);
  const boundary = isRecord(trace.boundary) ? trace.boundary : {};
  const claims = isRecord(trace.claims) ? trace.claims : {};
  const nowSec = Number(trace.nowSec);
  const fallbackNow = Number.isFinite(nowSec) ? nowSec : null;

  if (boundary.paymentSent === true) {
    violations.push(violation("payment_sent", "trace sent a live payment; expired-challenge fixtures must not pay"));
  }
  if (boundary.liveFacilitator === true || (boundary.facilitatorUrl && !loopbackUrl(boundary.facilitatorUrl))) {
    violations.push(violation(
      "live_facilitator",
      "trace used a non-loopback facilitator; this suite never settles on xpay/CDP",
    ));
  }
  if (boundary.checkoutMutated === true) {
    violations.push(violation("checkout_mutated", "expired-challenge suite must not mutate checkout"));
  }
  if (boundary.published === true) {
    violations.push(violation("published", "expired-challenge suite must not publish"));
  }
  if (trace.settleCount != null && settleFromAttempts !== declaredSettle && attempts.length > 0) {
    violations.push(violation(
      "settle_count_inconsistent",
      `declared settleCount ${declaredSettle} does not match attempt settleDelta sum ${settleFromAttempts}`,
    ));
  }
  if (attempts.length === 0) {
    violations.push(violation("no_attempts", "trace has no attempts"));
  }

  let challengeTimeout = Number.isSafeInteger(Number(trace.maxTimeoutSeconds))
    ? Number(trace.maxTimeoutSeconds)
    : null;
  let expiredAccepted = false;
  let notYetAccepted = false;
  let unboundedAccepted = false;
  let unknownValidityAccepted = false;

  for (const attempt of attempts) {
    const unpaid = attempt.phase === "unpaid" || attempt.paymentPresent === false;
    const timeout = timeoutOf(attempt, challengeTimeout ?? MAX_TIMEOUT_SECONDS);
    const settleDelta = numberOrZero(attempt.settleDelta);

    if (unpaid) {
      if (!isBoundedTimeout(attempt.maxTimeoutSeconds ?? challengeTimeout)) {
        violations.push(violation(
          "unbounded_timeout",
          "unpaid 402 exact accept must advertise maxTimeoutSeconds in 1..300",
          { seq: attempt.seq, maxTimeoutSeconds: attempt.maxTimeoutSeconds ?? null },
        ));
      } else {
        challengeTimeout = Number(attempt.maxTimeoutSeconds ?? challengeTimeout);
      }
      if (settleDelta > 0) {
        violations.push(violation("unpaid_settle", "unpaid 402 must not call facilitator settle", { seq: attempt.seq }));
      }
      if (attempt.hasPaymentResponse === true) {
        violations.push(violation(
          "unpaid_payment_response",
          "unpaid 402 must not carry PAYMENT-RESPONSE",
          { seq: attempt.seq },
        ));
      }
      continue;
    }

    const window = classifyWindow({
      validAfter: attempt.validAfter ?? "0",
      validBefore: attempt.validBefore,
      observedAtSec: observedAt(attempt, fallbackNow),
      maxTimeoutSeconds: timeout,
    });
    const delivered = looksDelivered(attempt);

    if (window.status === "unknown") {
      if (delivered) {
        unknownValidityAccepted = true;
        violations.push(violation(
          "missing_validity",
          "paid attempt omitted validBefore; fail closed",
          { seq: attempt.seq },
        ));
      }
      continue;
    }

    if (window.expired && delivered) {
      expiredAccepted = true;
      violations.push(violation(
        "expired_challenge_accepted",
        "expired EIP-3009 validBefore was delivered or settled",
        { seq: attempt.seq, validBefore: attempt.validBefore, observedAtSec: observedAt(attempt, fallbackNow) },
      ));
    }
    if (window.notYetValid && delivered) {
      notYetAccepted = true;
      violations.push(violation(
        "not_yet_valid_accepted",
        "authorization validAfter has not been reached but the payload was delivered",
        { seq: attempt.seq, validAfter: attempt.validAfter },
      ));
    }
    if (window.unbounded && delivered) {
      unboundedAccepted = true;
      violations.push(violation(
        "unbounded_validity",
        "payload remaining validity exceeds challenge maxTimeoutSeconds",
        { seq: attempt.seq, remainingSeconds: window.remainingSeconds, maxTimeoutSeconds: timeout },
      ));
    }
  }

  if (claims.ok === true && (expiredAccepted || notYetAccepted || unboundedAccepted || unknownValidityAccepted)) {
    violations.push(violation(
      "seeded_lie_expired_ok",
      "product claimed ok while an expired, not-yet-valid, or unbounded payload was accepted",
    ));
  }
  if (claims.expiredRejected === true && expiredAccepted) {
    violations.push(violation(
      "seeded_lie_expired_ok",
      "product claimed expiredRejected while the expired payload was accepted",
    ));
  }
  if (trace.requirePaidDelivery === true) {
    const paid = attempts.some((attempt) => attempt.paymentPresent !== false && attempt.phase !== "unpaid" && looksDelivered(attempt));
    if (!paid) {
      violations.push(violation(
        "within_window_rejected",
        "fresh in-window credential was required to deliver and did not",
      ));
    }
  }

  const primary = violations[0];
  const ok = violations.length === 0;
  return {
    ok,
    code: ok ? "guard-holds" : primary.code,
    id: trace.id ?? null,
    expect: trace.expect ?? null,
    rejectCode: trace.rejectCode ?? null,
    settleCount,
    verifyCount: numberOrZero(trace.verifyCount),
    maxTimeoutSeconds: challengeTimeout,
    expiredAccepted,
    notYetAccepted,
    unboundedAccepted,
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
      maxTimeoutSeconds: evaluated.maxTimeoutSeconds,
      expiredAccepted: evaluated.expiredAccepted,
      violations: evaluated.violations,
      attempts: scenario.attempts,
      origin: scenario.origin ?? null,
    };
  });
  const failed = rows.filter((row) => !row.ok);
  const paymentSent = scenarios.some((scenario) => scenario.boundary?.paymentSent === true);
  const expiredAccepted = rows.some((row) => row.expiredAccepted);
  return {
    ok: failed.length === 0 && rows.length > 0 && !paymentSent && !expiredAccepted,
    code: failed[0]?.code ?? (rows.length ? "guard-holds" : "no_scenarios"),
    mode: "cold",
    artifact: "server.js",
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed: failed.map((row) => ({ id: row.id, code: row.code, violations: row.violations })),
    settleCounts: rows.map((row) => row.settleCount),
    paymentSent,
    expiredAccepted,
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
