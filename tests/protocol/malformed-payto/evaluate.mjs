import { classifyPayTo, isWellFormedPayTo, samePayTo } from "./payto.mjs";

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

function quotedPayToOf(attempt, fallback) {
  if (attempt.quotedPayTo != null) return attempt.quotedPayTo;
  if (attempt.phase === "unpaid" || attempt.paymentPresent === false) {
    if (attempt.payTo != null) return attempt.payTo;
    if (attempt.acceptedPayTo != null) return attempt.acceptedPayTo;
  }
  return fallback;
}

function payloadPayToFields(attempt) {
  const authorizationTo = attempt.authorizationTo ?? attempt.payloadTo ?? null;
  const acceptedPayTo = attempt.acceptedPayTo ?? null;
  return { authorizationTo, acceptedPayTo };
}

/**
 * Evaluate one x402 payTo trace.
 * Holds iff unpaid 402 advertises a well-formed EVM payTo and malformed
 * payload payTo / authorization.to values are not delivered or settled.
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
    violations.push(violation("payment_sent", "trace sent a live payment; malformed-payto fixtures must not pay"));
  }
  if (boundary.liveFacilitator === true || (boundary.facilitatorUrl && !loopbackUrl(boundary.facilitatorUrl))) {
    violations.push(violation(
      "live_facilitator",
      "trace used a non-loopback facilitator; this suite never settles on xpay/CDP",
    ));
  }
  if (boundary.checkoutMutated === true) {
    violations.push(violation("checkout_mutated", "malformed-payto suite must not mutate checkout"));
  }
  if (boundary.published === true) {
    violations.push(violation("published", "malformed-payto suite must not publish"));
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

  let quotedPayTo = trace.payTo ?? trace.quotedPayTo ?? null;
  let malformedPayToAccepted = false;
  let payToMismatchAccepted = false;
  let missingPayToAccepted = false;

  for (const attempt of attempts) {
    const unpaid = attempt.phase === "unpaid" || attempt.paymentPresent === false;
    const settleDelta = numberOrZero(attempt.settleDelta);

    if (unpaid) {
      const quoted = quotedPayToOf(attempt, quotedPayTo);
      if (quoted != null) quotedPayTo = quoted;
      if (!isWellFormedPayTo(quoted)) {
        violations.push(violation(
          "malformed_quoted_payto",
          "unpaid 402 exact accept must advertise a 0x-prefixed 40-hex EVM payTo",
          { seq: attempt.seq, payTo: quoted ?? null, classification: classifyPayTo(quoted).status },
        ));
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

    const delivered = looksDelivered(attempt);
    const { authorizationTo, acceptedPayTo } = payloadPayToFields(attempt);
    const present = [authorizationTo, acceptedPayTo].filter((value) => value !== null && value !== undefined);
    const malformedPresent = present.filter((value) => !isWellFormedPayTo(value));

    if (present.length === 0) {
      if (delivered) {
        missingPayToAccepted = true;
        violations.push(violation(
          "missing_payto",
          "paid attempt omitted payTo; fail closed",
          { seq: attempt.seq },
        ));
      }
      continue;
    }

    if (malformedPresent.length > 0 && delivered) {
      malformedPayToAccepted = true;
      violations.push(violation(
        "malformed_payto_accepted",
        "malformed payTo or authorization.to was delivered or settled",
        {
          seq: attempt.seq,
          authorizationTo: authorizationTo ?? null,
          acceptedPayTo: acceptedPayTo ?? null,
          classification: classifyPayTo(malformedPresent[0]).status,
        },
      ));
    }

    const quoted = attempt.quotedPayTo ?? quotedPayTo;
    const payloadTo = authorizationTo ?? acceptedPayTo;
    if (
      delivered
      && isWellFormedPayTo(quoted)
      && isWellFormedPayTo(payloadTo)
      && !samePayTo(quoted, payloadTo)
    ) {
      payToMismatchAccepted = true;
      violations.push(violation(
        "payto_mismatch_accepted",
        "authorization.to / accepted.payTo does not match the quoted 402 payTo but was delivered",
        { seq: attempt.seq, quotedPayTo: quoted, payloadTo },
      ));
    }
  }

  if (claims.ok === true && (malformedPayToAccepted || payToMismatchAccepted || missingPayToAccepted)) {
    violations.push(violation(
      "seeded_lie_malformed_payto_ok",
      "product claimed ok while a malformed or mismatched payTo was accepted",
    ));
  }
  if (claims.malformedPayToRejected === true && malformedPayToAccepted) {
    violations.push(violation(
      "seeded_lie_malformed_payto_ok",
      "product claimed malformedPayToRejected while the malformed payTo was accepted",
    ));
  }
  if (trace.requirePaidDelivery === true) {
    const paid = attempts.some((attempt) => attempt.paymentPresent !== false && attempt.phase !== "unpaid" && looksDelivered(attempt));
    if (!paid) {
      violations.push(violation(
        "wellformed_payto_rejected",
        "well-formed matching payTo credential was required to deliver and did not",
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
    payTo: quotedPayTo,
    malformedPayToAccepted,
    payToMismatchAccepted,
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
      payTo: evaluated.payTo,
      malformedPayToAccepted: evaluated.malformedPayToAccepted,
      violations: evaluated.violations,
      attempts: scenario.attempts,
      origin: scenario.origin ?? null,
    };
  });
  const failed = rows.filter((row) => !row.ok);
  const paymentSent = scenarios.some((scenario) => scenario.boundary?.paymentSent === true);
  const malformedPayToAccepted = rows.some((row) => row.malformedPayToAccepted);
  return {
    ok: failed.length === 0 && rows.length > 0 && !paymentSent && !malformedPayToAccepted,
    code: failed[0]?.code ?? (rows.length ? "guard-holds" : "no_scenarios"),
    mode: "cold",
    artifact: "server.js",
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed: failed.map((row) => ({ id: row.id, code: row.code, violations: row.violations })),
    settleCounts: rows.map((row) => row.settleCount),
    paymentSent,
    malformedPayToAccepted,
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
