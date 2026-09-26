import {
  ABSENT_ROUTE,
  CODES,
  DECLARED_FREE_ROUTE,
  DECLARED_PAID_ROUTE,
  LOOKALIKE_ROUTES,
  METHOD_ABSENT,
} from "./constants.mjs";

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

function pathOf(attempt) {
  return typeof attempt?.path === "string" ? attempt.path.split("?")[0] : "";
}

function methodOf(attempt) {
  return typeof attempt?.method === "string" && attempt.method
    ? attempt.method.toUpperCase()
    : "GET";
}

function roleOf(attempt, absentRoute, declaredPaid, declaredFree) {
  const path = pathOf(attempt);
  const method = methodOf(attempt);
  const declaredPaidFold = declaredPaid.toLowerCase();
  if (
    path
    && path !== declaredFree
    && path.toLowerCase() !== declaredPaidFold
    && (path === ABSENT_ROUTE || path === absentRoute)
  ) {
    return "absent";
  }
  if (LOOKALIKE_ROUTES.includes(path)) return "absent";
  if (path === METHOD_ABSENT.path && method === METHOD_ABSENT.method) return "absent";
  if (typeof attempt?.role === "string" && attempt.role) return attempt.role;
  if (typeof attempt?.phase === "string" && attempt.phase) {
    if (attempt.phase.startsWith("absent")) return "absent";
    if (attempt.phase.startsWith("paid-control") || attempt.phase === "unpaid") return "paid-control";
    if (attempt.phase.startsWith("free")) return "free-surface";
    if (attempt.phase.startsWith("lookalike") || attempt.phase.startsWith("method-absent")) return "absent";
    if (attempt.phase.startsWith("catalog")) return "catalog";
  }
  if (path === declaredFree && method === "GET") return "free-surface";
  if (method === "GET" && path && path.toLowerCase() === declaredPaidFold) {
    return "paid-control";
  }
  return "unknown";
}

function hasPaymentRequired(attempt) {
  if (attempt?.hasPaymentRequired === true) return true;
  if (attempt?.hasPaymentRequiredHeader === true) return true;
  if (typeof attempt?.offeredNetwork === "string" && attempt.offeredNetwork && Number(attempt.httpStatus) === 402) {
    return true;
  }
  return false;
}

function is402(attempt) {
  return Number(attempt?.httpStatus) === 402;
}

function isSuccess(attempt) {
  const status = Number(attempt?.httpStatus);
  return status >= 200 && status < 300;
}

function catalogOf(trace) {
  return isRecord(trace?.catalog) ? trace.catalog : null;
}

function wellKnownRoutes(trace) {
  const listed = trace?.wellKnown?.itemRoutes;
  return Array.isArray(listed) ? listed.filter((item) => typeof item === "string") : [];
}

/**
 * Evaluate one w811 route_absent trace.
 *
 * A path that is not a declared x402 paid route must not 402, must not
 * advertise PAYMENT-REQUIRED, and must not verify or settle. Catalogs that
 * list the origin on a different path report priceObservation.status
 * `route_absent` and finding `origin_found_expected_route_absent`.
 */
export function evaluateTrace(trace = {}) {
  const violations = [];
  const attempts = attemptsOf(trace);
  const claims = isRecord(trace.claims) ? trace.claims : {};
  const boundary = isRecord(trace.boundary) ? trace.boundary : {};
  const catalog = catalogOf(trace);
  const absentRoute = typeof trace.route === "string" && trace.route.startsWith("/")
    ? trace.route
    : ABSENT_ROUTE;
  const declaredPaid = typeof trace.declaredPaidRoute === "string"
    ? trace.declaredPaidRoute
    : DECLARED_PAID_ROUTE;
  const declaredFree = typeof trace.declaredFreeRoute === "string"
    ? trace.declaredFreeRoute
    : DECLARED_FREE_ROUTE;

  const settleFromAttempts = attempts.reduce((sum, attempt) => sum + numberOrZero(attempt.settleDelta), 0);
  const verifyFromAttempts = attempts.reduce((sum, attempt) => sum + numberOrZero(attempt.verifyDelta), 0);
  const declaredSettle = trace.settleCount == null ? settleFromAttempts : numberOrZero(trace.settleCount);
  const declaredVerify = trace.verifyCount == null ? verifyFromAttempts : numberOrZero(trace.verifyCount);
  const settleCount = Math.max(settleFromAttempts, declaredSettle);
  const verifyCount = Math.max(verifyFromAttempts, declaredVerify);

  if (boundary.paymentSent === true) {
    violations.push(violation(CODES.PAYMENT_SENT, "trace sent a live payment; w811 must not pay"));
  }
  if (boundary.liveFacilitator === true || (boundary.facilitatorUrl && !loopbackUrl(boundary.facilitatorUrl))) {
    violations.push(violation(
      CODES.LIVE_FACILITATOR,
      "trace used a non-loopback facilitator; this suite never settles on xpay/CDP",
    ));
  }
  if (boundary.checkoutMutated === true) {
    violations.push(violation(CODES.CHECKOUT_MUTATED, "w811 must not mutate checkout"));
  }
  if (boundary.published === true) {
    violations.push(violation(CODES.PUBLISHED, "w811 must not publish"));
  }
  if (boundary.neoTouched === true) {
    violations.push(violation(CODES.NEO_TOUCHED, "w811 must not touch neomorphic-io"));
  }

  let absentAttempts = 0;
  let absentAs402 = 0;
  let paidControlAttempts = 0;
  let paidControl402 = 0;
  let freeSurfaceAttempts = 0;

  for (const attempt of attempts) {
    const role = roleOf(attempt, absentRoute, declaredPaid, declaredFree);
    const settleDelta = numberOrZero(attempt.settleDelta);
    const verifyDelta = numberOrZero(attempt.verifyDelta);

    if (role === "absent") {
      absentAttempts += 1;
      if (is402(attempt)) {
        absentAs402 += 1;
        violations.push(violation(
          CODES.ABSENT_ROUTE_AS_402,
          `undeclared path ${attempt.path || absentRoute} returned HTTP 402`,
          { seq: attempt.seq, httpStatus: attempt.httpStatus, path: attempt.path || absentRoute },
        ));
      }
      if (hasPaymentRequired(attempt)) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_PAYMENT_REQUIRED,
          "undeclared path must not advertise PAYMENT-REQUIRED",
          { seq: attempt.seq, path: attempt.path || absentRoute },
        ));
      }
      if (attempt.hasPaymentResponse === true) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_PAYMENT_RESPONSE,
          "undeclared path must not carry PAYMENT-RESPONSE",
          { seq: attempt.seq },
        ));
      }
      if (settleDelta > 0) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_SETTLE,
          "undeclared path must not call facilitator settle",
          { seq: attempt.seq },
        ));
      }
      if (verifyDelta > 0) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_VERIFY,
          "undeclared path must not call facilitator verify",
          { seq: attempt.seq },
        ));
      }
      if (attempt.charged === true) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_CHARGED,
          "undeclared path must not mark the request charged",
          { seq: attempt.seq },
        ));
      }
      if (attempt.payable === true) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_PAYABLE,
          "undeclared path must not be classified payable",
          { seq: attempt.seq },
        ));
      }
    }

    if (role === "paid-control") {
      paidControlAttempts += 1;
      if (is402(attempt)) paidControl402 += 1;
      else {
        violations.push(violation(
          CODES.DECLARED_PAID_NOT_402,
          `declared paid route ${attempt.path || declaredPaid} must still 402 when unpaid`,
          { seq: attempt.seq, httpStatus: attempt.httpStatus },
        ));
      }
      if (attempt.routeAbsent === true) {
        violations.push(violation(
          CODES.DECLARED_PAID_AS_ABSENT,
          "declared paid 402 must not be classified route_absent",
          { seq: attempt.seq },
        ));
      }
      if (settleDelta > 0) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_SETTLE,
          "unpaid declared-route 402 must not settle",
          { seq: attempt.seq },
        ));
      }
    }

    if (role === "free-surface") {
      freeSurfaceAttempts += 1;
      if (is402(attempt)) {
        violations.push(violation(
          CODES.FREE_SURFACE_AS_402,
          `declared free surface ${attempt.path || declaredFree} must not 402`,
          { seq: attempt.seq, httpStatus: attempt.httpStatus },
        ));
      }
      if (attempt.routeAbsent === true) {
        violations.push(violation(
          CODES.FREE_SURFACE_AS_ABSENT,
          "declared free surface is present, not route_absent",
          { seq: attempt.seq, path: attempt.path || declaredFree },
        ));
      }
      if (settleDelta > 0 || verifyDelta > 0) {
        violations.push(violation(
          CODES.ABSENT_ROUTE_SETTLE,
          "declared free surface must not verify or settle",
          { seq: attempt.seq },
        ));
      }
    }
  }

  const listed = wellKnownRoutes(trace);
  if (listed.length > 0 && listed.includes(absentRoute)) {
    violations.push(violation(
      CODES.WELL_KNOWN_LISTS_ABSENT,
      `/.well-known/x402 listed undeclared path ${absentRoute}`,
      { itemRoutes: listed },
    ));
  }
  if (trace.wellKnown?.includesAbsentRoute === true) {
    violations.push(violation(
      CODES.WELL_KNOWN_LISTS_ABSENT,
      "trace claimed the discovery document includes the absent route",
    ));
  }

  if (catalog) {
    const status = catalog.priceObservationStatus ?? catalog.status;
    const expectedRouteFound = catalog.expectedRouteFound;
    const findings = Array.isArray(catalog.findings) ? catalog.findings : [];
    const findingCodes = findings.map((item) => (typeof item === "string" ? item : item?.finding)).filter(Boolean);
    if (status !== "route_absent") {
      violations.push(violation(
        CODES.CATALOG_MISSING_ROUTE_ABSENT,
        `catalog priceObservation.status must be route_absent, got ${status}`,
        { status },
      ));
    }
    if (expectedRouteFound === true) {
      violations.push(violation(
        CODES.CATALOG_ROUTE_ABSENT_AS_MATCHED,
        "catalog claimed expectedRouteFound while the listed path differed",
      ));
    }
    if (
      catalog.targetFound === true
      && expectedRouteFound !== true
      && !findingCodes.includes("origin_found_expected_route_absent")
    ) {
      violations.push(violation(
        CODES.CATALOG_MISSING_ROUTE_ABSENT,
        "origin found without expected route must emit origin_found_expected_route_absent",
      ));
    }
    if (catalog.matched === true || catalog.payable === true || catalog.charged === true) {
      violations.push(violation(
        CODES.CATALOG_ROUTE_ABSENT_AS_MATCHED,
        "catalog route_absent must not be claimed matched, payable, or charged",
      ));
    }
  }

  if (claims.ok === true && absentAs402 > 0) {
    violations.push(violation(
      CODES.ABSENT_ROUTE_AS_402,
      "product claimed ok while an undeclared path returned HTTP 402",
    ));
  }
  if (claims.payable === true && (absentAttempts > 0 || catalog)) {
    violations.push(violation(
      CODES.ABSENT_ROUTE_PAYABLE,
      "product claimed payable on a route_absent observation",
    ));
  }
  if (claims.charged === true && (absentAttempts > 0 || catalog)) {
    violations.push(violation(
      CODES.ABSENT_ROUTE_CHARGED,
      "product claimed charged on a route_absent observation",
    ));
  }
  if (claims.settled === true && (absentAttempts > 0 || catalog)) {
    violations.push(violation(
      CODES.ABSENT_ROUTE_SETTLE,
      "product claimed settlement on an undeclared path",
    ));
  }
  if (claims.routeAbsent === true && paidControl402 > 0 && absentAttempts === 0 && !catalog) {
    violations.push(violation(
      CODES.DECLARED_PAID_AS_ABSENT,
      "product claimed route_absent for a declared paid 402 control",
    ));
  }
  if (claims.routeAbsent === true && freeSurfaceAttempts > 0 && absentAttempts === 0 && !catalog) {
    violations.push(violation(
      CODES.FREE_SURFACE_AS_ABSENT,
      "product claimed route_absent for a declared free surface",
    ));
  }

  if (trace.settleCount != null && settleFromAttempts !== declaredSettle && attempts.length > 0) {
    violations.push(violation(
      CODES.SETTLE_COUNT_INCONSISTENT,
      `declared settleCount ${declaredSettle} does not match attempt settleDelta sum ${settleFromAttempts}`,
    ));
  }
  if (trace.verifyCount != null && verifyFromAttempts !== declaredVerify && attempts.length > 0) {
    violations.push(violation(
      CODES.VERIFY_COUNT_INCONSISTENT,
      `declared verifyCount ${declaredVerify} does not match attempt verifyDelta sum ${verifyFromAttempts}`,
    ));
  }

  const hasEvidence = attempts.length > 0 || Boolean(catalog);
  const primary = violations[0];
  const ok = violations.length === 0 && hasEvidence;
  return {
    ok,
    code: violations.length === 0
      ? (hasEvidence ? CODES.ROUTE_ABSENT_HOLDS : CODES.COLD_INCOMPLETE)
      : primary.code,
    id: trace.id ?? null,
    expect: trace.expect ?? null,
    rejectCode: trace.rejectCode ?? null,
    settleCount,
    verifyCount,
    absentAttempts,
    absentAs402,
    paidControlAttempts,
    paidControl402,
    freeSurfaceAttempts,
    violations,
    claimsRejected: Boolean(
      (claims.ok === true || claims.payable === true || claims.charged === true || claims.settled === true)
      && violations.length > 0,
    ),
    claims,
    catalog,
    boundary: {
      paymentSent: boundary.paymentSent === true,
      liveFacilitator: boundary.liveFacilitator === true,
      checkoutMutated: boundary.checkoutMutated === true,
      published: boundary.published === true,
      neoTouched: boundary.neoTouched === true,
    },
  };
}

export function evaluateFixture(fixture) {
  return classifyFixture(fixture);
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
    const codeOk = !fixture.rejectCode
      || evaluated.code === fixture.rejectCode
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
    code: CODES.MALFORMED_FIXTURE,
  };
}

export function evaluateColdSuite(scenarios = []) {
  const rows = scenarios.map((scenario) => {
    const evaluated = evaluateTrace(scenario);
    return {
      id: scenario.id,
      rail: scenario.rail ?? "x402",
      kind: scenario.kind ?? null,
      ok: evaluated.ok,
      code: evaluated.code,
      settleCount: evaluated.settleCount,
      verifyCount: evaluated.verifyCount,
      absentAttempts: evaluated.absentAttempts,
      absentAs402: evaluated.absentAs402,
      paidControlAttempts: evaluated.paidControlAttempts,
      paidControl402: evaluated.paidControl402,
      violations: evaluated.violations,
      attempts: scenario.attempts,
      catalog: evaluated.catalog,
      origin: scenario.origin ?? null,
      wellKnown: scenario.wellKnown ?? null,
    };
  });
  const failed = rows.filter((row) => !row.ok);
  const httpAbsent = rows.find((row) => row.id === "x402-route-absent-http");
  const paidControl = rows.find((row) => row.id === "x402-declared-paid-control");
  const freeSurface = rows.find((row) => row.id === "x402-declared-free-not-absent");
  const catalog = rows.find((row) => row.id === "x402-catalog-route-absent");
  const paymentSent = scenarios.some((scenario) => scenario.boundary?.paymentSent === true);
  const httpOk = Boolean(httpAbsent && httpAbsent.ok && httpAbsent.absentAttempts > 0 && httpAbsent.absentAs402 === 0 && httpAbsent.settleCount === 0);
  const paidOk = Boolean(paidControl && paidControl.ok && paidControl.paidControl402 > 0);
  const freeOk = Boolean(freeSurface && freeSurface.ok);
  const catalogOk = Boolean(catalog && catalog.ok && catalog.catalog?.priceObservationStatus === "route_absent");
  return {
    ok: failed.length === 0 && httpOk && paidOk && freeOk && catalogOk && !paymentSent && rows.length > 0,
    code: failed[0]?.code ?? (httpOk && paidOk && catalogOk ? CODES.ROUTE_ABSENT_HOLDS : CODES.COLD_INCOMPLETE),
    mode: "cold",
    artifact: "server.js",
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed: failed.map((row) => ({ id: row.id, code: row.code, violations: row.violations })),
    settleCounts: rows.map((row) => row.settleCount),
    verifyCounts: rows.map((row) => row.verifyCount),
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
