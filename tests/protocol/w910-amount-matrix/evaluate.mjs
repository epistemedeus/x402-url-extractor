import { CODES, ROUTE_IDS, ROUTES, SDS } from "./constants.mjs";
import {
  claimsDemandSettlement,
  claimsTreatAbsenceAsDemand,
  classifyAtomic,
  classifyRouteObservation,
  stringEqual,
} from "./classify.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function violation(code, message, extra = {}) {
  return { code, message, ...extra };
}

function observationOf(fixture) {
  return isRecord(fixture?.observation) ? fixture.observation : fixture;
}

function requestOf(fixture) {
  return isRecord(fixture?.request) ? fixture.request : {};
}

function claimsOf(fixture) {
  return isRecord(fixture?.claims) ? fixture.claims : {};
}

function countersOf(fixture) {
  return isRecord(fixture?.counters) ? fixture.counters : {};
}

function routeIdOf(fixture) {
  if (typeof fixture?.routeId === "string") return fixture.routeId;
  if (typeof fixture?.id === "string" && ROUTES[fixture.id]) return fixture.id;
  return null;
}

function pinMismatchAmount(actual, pinAmount, surface) {
  const classified = classifyAtomic(actual);
  if (classified.kind === "missing") {
    return violation(CODES.AMOUNT_MISSING, `${surface} accepts[].amount is missing`, { surface });
  }
  if (classified.kind === "not_string") {
    return violation(
      CODES.AMOUNT_NOT_STRING,
      `${surface} amount ${JSON.stringify(actual)} is ${classified.jsType}, not a canonical integer string`,
      { surface, actual, jsType: classified.jsType },
    );
  }
  if (classified.kind === "not_canonical") {
    return violation(
      CODES.AMOUNT_NOT_CANONICAL,
      `${surface} amount ${JSON.stringify(actual)} is not a canonical integer string (no leading zeros, no decimals, no scientific notation)`,
      { surface, actual },
    );
  }
  if (!stringEqual(classified.value, pinAmount)) {
    return violation(
      CODES.AMOUNT_MISMATCH,
      `${surface} amount ${JSON.stringify(classified.value)} does not string-equal pin ${pinAmount}`,
      { surface, expected: pinAmount, actual: classified.value },
    );
  }
  return null;
}

function sharedBoundaryViolations(classified, request, claims, counters) {
  const violations = [];
  if (classified.invented?.length) {
    violations.push(violation(
      CODES.INVENTED_RECEIPT_FIELD,
      `invented receipt field without live schema: ${classified.invented.join(",")}`,
      { invented: classified.invented },
    ));
  }
  if (classified.paymentSignatureSent || request.paymentSignatureSent === true) {
    violations.push(violation(
      CODES.PAYMENT_SIGNATURE_SENT,
      "PAYMENT-SIGNATURE / x402/payment was sent; this suite is unpaid only",
    ));
  }
  if (Number(counters.verify) > 0) {
    violations.push(violation(CODES.VERIFY_ON_UNPAID, "unpaid hop called facilitator verify"));
  }
  if (Number(counters.settle) > 0) {
    violations.push(violation(CODES.SETTLE_ON_UNPAID, "unpaid hop called facilitator settle"));
  }
  if (claimsDemandSettlement(claims)) {
    violations.push(violation(
      CODES.HTTP_402_CLASSIFIED_AS_SETTLEMENT,
      "HTTP 402 / unpaid MCP list amount is an offer, not charged/paid delivery/settlement",
      {
        claims: {
          charged: claims.charged ?? null,
          paidDelivery: claims.paidDelivery ?? null,
          successProven: claims.successProven ?? null,
          settlement: claims.settlement ?? claims.settled ?? null,
        },
      },
    ));
  }
  return violations;
}

export function evaluateRoute(fixture = {}) {
  const routeId = routeIdOf(fixture);
  const pin = ROUTES[routeId];
  const observation = observationOf(fixture);
  const request = requestOf(fixture);
  const claims = claimsOf(fixture);
  const counters = countersOf(fixture);
  const violations = [];

  if (!isRecord(fixture) || !routeId || !pin) {
    return {
      ok: false,
      code: CODES.MALFORMED_FIXTURE,
      id: fixture?.id ?? null,
      expect: fixture?.expect ?? null,
      rejectCode: fixture?.rejectCode ?? null,
      routeId,
      classified: null,
      violations: [violation(CODES.MALFORMED_FIXTURE, "fixture is missing a known routeId")],
      claimsRejected: false,
    };
  }

  const classified = classifyRouteObservation(routeId, observation, request);
  violations.push(...sharedBoundaryViolations(classified, request, claims, counters));

  const httpMissing = !isRecord(observation.http);
  const mcpMissing = classified.mcpPresent !== true;
  const openapiMissing = classified.openapiPresent !== true;
  const surfaceMissing = httpMissing || mcpMissing || openapiMissing;
  if (surfaceMissing && (claimsTreatAbsenceAsDemand(claims) || claims.absenceIsDemand === true || claimsDemandSettlement(claims))) {
    violations.push(violation(
      CODES.ABSENCE_AS_DEMAND,
      "catalog or surface absence is not buyer demand and not a charge",
      { httpMissing, mcpMissing, openapiMissing },
    ));
  }

  if (classified.httpStatus !== 402) {
    violations.push(violation(
      CODES.HTTP_NOT_402,
      `HTTP ${classified.httpPath || pin.httpPath} status ${classified.httpStatus} is not unpaid 402`,
      { httpStatus: classified.httpStatus },
    ));
  }

  if (classified.mcpStatus && classified.mcpStatus !== 200) {
    violations.push(violation(
      CODES.MCP_LIST_NOT_UNPAID,
      `MCP tools/list HTTP ${classified.mcpStatus} is not unpaid discovery`,
    ));
  } else if (classified.mcpPresent && classified.paymentRequired !== true && observation.mcp?.paymentRequired !== true) {
    if (observation.mcp && observation.mcp.paymentRequired !== true) {
      violations.push(violation(
        CODES.MCP_LIST_NOT_UNPAID,
        "MCP tool must advertise _meta.x402.paymentRequired=true",
      ));
    }
  }

  if (classified.crossSurfaceDrift) {
    violations.push(violation(
      CODES.CROSS_SURFACE_DRIFT,
      `amount strings drift across surfaces: ${classified.uniqueCanonicalAmounts.join(",")}`,
      { amounts: classified.uniqueCanonicalAmounts },
    ));
  }

  const httpAmountCheck = pinMismatchAmount(classified.httpAmount.value ?? observation.http?.amount, pin.amountAtomic, "http");
  if (httpAmountCheck) violations.push(httpAmountCheck);

  if (classified.mcpPresent || isRecord(observation.mcp)) {
    const mcpAmountCheck = pinMismatchAmount(
      classified.mcpAmount.value ?? observation.mcp?.amount,
      pin.amountAtomic,
      "mcp",
    );
    if (mcpAmountCheck) violations.push(mcpAmountCheck);
  } else {
    violations.push(violation(CODES.AMOUNT_MISSING, "MCP tools/list amount is missing", { surface: "mcp" }));
  }

  if (classified.wellKnownPresent || isRecord(observation.wellKnown)) {
    const wellKnownCheck = pinMismatchAmount(
      classified.wellKnownAmount.value ?? observation.wellKnown?.amount,
      pin.amountAtomic,
      "wellKnown",
    );
    if (wellKnownCheck) violations.push(wellKnownCheck);
  }

  if (classified.maxAmountRequired != null && classified.httpAmount.canonical) {
    if (!stringEqual(classified.maxAmountRequired, classified.httpAmount.value)) {
      violations.push(violation(
        CODES.AMOUNT_MISMATCH,
        `legacy maxAmountRequired ${JSON.stringify(classified.maxAmountRequired)} does not string-equal amount ${classified.httpAmount.value}`,
        { expected: classified.httpAmount.value, actual: classified.maxAmountRequired },
      ));
    }
  }

  if (classified.payTo && classified.payTo !== SDS.payTo) {
    violations.push(violation(
      CODES.AMOUNT_MISMATCH,
      `accepts[].payTo ${classified.payTo} does not match SDS payTo`,
      { expected: SDS.payTo, actual: classified.payTo },
    ));
  }
  if (classified.network && classified.network !== SDS.network) {
    violations.push(violation(
      CODES.AMOUNT_MISMATCH,
      `accepts[].network ${classified.network} does not match SDS ${SDS.network}`,
      { expected: SDS.network, actual: classified.network },
    ));
  }
  if (classified.asset && classified.asset !== SDS.asset) {
    violations.push(violation(
      CODES.AMOUNT_MISMATCH,
      `accepts[].asset ${classified.asset} does not match SDS asset`,
      { expected: SDS.asset, actual: classified.asset },
    ));
  }

  if (!classified.openapiPresent && !isRecord(observation.openapi)) {
    violations.push(violation(
      CODES.OPENAPI_PRICE_MISMATCH,
      "OpenAPI 402 description is missing",
      { surface: "openapi" },
    ));
  } else {
    const priceUsd = classified.openapiPriceUsd;
    if (typeof priceUsd !== "string") {
      violations.push(violation(
        CODES.OPENAPI_PRICE_MISMATCH,
        `OpenAPI 402 price token is ${JSON.stringify(priceUsd)}, not pin ${pin.priceUsd}`,
        { expected: pin.priceUsd, actual: priceUsd },
      ));
    } else if (!stringEqual(priceUsd, pin.priceUsd)) {
      violations.push(violation(
        CODES.OPENAPI_PRICE_MISMATCH,
        `OpenAPI 402 price ${JSON.stringify(priceUsd)} does not string-equal pin ${pin.priceUsd}`,
        { expected: pin.priceUsd, actual: priceUsd },
      ));
    }
  }

  const primary = violations[0];
  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? CODES.UNPAID_AMOUNT_MATRIX : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    routeId,
    classified,
    violations,
    claimsRejected: claimsDemandSettlement(claims)
      && violations.some((item) => item.code === CODES.HTTP_402_CLASSIFIED_AS_SETTLEMENT),
  };
}

export function evaluateMatrix(fixture = {}) {
  if (!isRecord(fixture)) {
    return {
      ok: false,
      code: CODES.MALFORMED_FIXTURE,
      id: null,
      expect: null,
      rejectCode: null,
      method: "amount-matrix",
      classified: null,
      violations: [violation(CODES.MALFORMED_FIXTURE, "fixture is not an object")],
      claimsRejected: false,
      routes: [],
    };
  }

  const entries = Array.isArray(fixture.routes) ? fixture.routes : [];
  const byId = new Map();
  for (const entry of entries) {
    const id = routeIdOf(entry);
    if (id) byId.set(id, entry);
  }

  const claims = claimsOf(fixture);
  const violations = [];
  const routes = [];

  for (const routeId of ROUTE_IDS) {
    const entry = byId.get(routeId);
    if (!entry) {
      const missing = violation(
        claimsTreatAbsenceAsDemand(claims) ? CODES.ABSENCE_AS_DEMAND : CODES.AMOUNT_MISSING,
        `matrix is missing route ${routeId}`,
        { routeId },
      );
      violations.push(missing);
      routes.push({
        routeId,
        ok: false,
        code: missing.code,
        violations: [missing],
      });
      continue;
    }
    const evaluated = evaluateRoute({
      ...entry,
      id: entry.id || `${fixture.id || "matrix"}:${routeId}`,
      routeId,
      claims: { ...claimsOf(entry), ...claims },
      request: { ...requestOf(fixture), ...requestOf(entry) },
      counters: { ...countersOf(fixture), ...countersOf(entry) },
    });
    routes.push(evaluated);
    violations.push(...evaluated.violations.map((item) => ({ ...item, routeId })));
  }

  if (claimsTreatAbsenceAsDemand(claims) && !violations.some((item) => item.code === CODES.ABSENCE_AS_DEMAND)) {
    violations.unshift(violation(
      CODES.ABSENCE_AS_DEMAND,
      "seeded claim that a missing route is buyer demand is rejected",
    ));
  }

  const primary = violations[0];
  return {
    ok: violations.length === 0,
    code: violations.length === 0 ? CODES.UNPAID_AMOUNT_MATRIX : primary.code,
    id: fixture.id ?? null,
    expect: fixture.expect ?? null,
    rejectCode: fixture.rejectCode ?? null,
    method: "amount-matrix",
    classified: {
      routeIds: routes.map((route) => route.routeId),
      amounts: Object.fromEntries(routes.map((route) => [
        route.routeId,
        {
          http: route.classified?.httpAmount?.value ?? null,
          mcp: route.classified?.mcpAmount?.value ?? null,
          wellKnown: route.classified?.wellKnownAmount?.value ?? null,
          openapi: route.classified?.openapiPriceUsd ?? null,
        },
      ])),
    },
    violations,
    claimsRejected: claimsDemandSettlement(claims)
      && violations.some((item) => item.code === CODES.HTTP_402_CLASSIFIED_AS_SETTLEMENT),
    routes,
  };
}

function isMatrixFixture(fixture) {
  return fixture?.kind === "amount-matrix"
    || Array.isArray(fixture?.routes)
    || fixture?.method === "amount-matrix";
}

export function evaluateFixture(fixture = {}) {
  if (!isRecord(fixture)) {
    return {
      ok: false,
      code: CODES.MALFORMED_FIXTURE,
      id: null,
      expect: null,
      rejectCode: null,
      method: null,
      classified: null,
      violations: [violation(CODES.MALFORMED_FIXTURE, "fixture is not an object")],
      claimsRejected: false,
    };
  }
  return isMatrixFixture(fixture) ? evaluateMatrix(fixture) : evaluateRoute(fixture);
}

export function classifyFixture(fixture) {
  const evaluated = evaluateFixture(fixture);
  const expect = fixture?.expect;
  if (expect === "pass") {
    return {
      ...evaluated,
      classifiedOk: evaluated.ok,
      verdict: evaluated.ok ? "pass" : "fail",
    };
  }
  if (expect === "reject") {
    const codeOk = !fixture.rejectCode
      || evaluated.code === fixture.rejectCode
      || evaluated.violations.some((item) => item.code === fixture.rejectCode);
    const rejected = evaluated.ok === false && codeOk;
    return {
      ...evaluated,
      classifiedOk: rejected,
      verdict: rejected ? "rejected" : "not-rejected",
    };
  }
  return {
    ...evaluated,
    classifiedOk: evaluated.ok,
    verdict: evaluated.ok ? "pass" : "fail",
  };
}

export function evaluateFixtureCorpus(passEntries, rejectEntries) {
  const rows = [];
  for (const entry of passEntries) {
    const classified = classifyFixture(entry.fixture);
    rows.push({
      id: entry.id,
      path: entry.relativePath,
      expect: "pass",
      ok: classified.verdict === "pass",
      code: classified.code,
      verdict: classified.verdict,
    });
  }
  for (const entry of rejectEntries) {
    const classified = classifyFixture(entry.fixture);
    rows.push({
      id: entry.id,
      path: entry.relativePath,
      expect: "reject",
      rejectCode: entry.rejectCode,
      ok: classified.verdict === "rejected",
      code: classified.code,
      verdict: classified.verdict,
    });
  }
  const failed = rows.filter((row) => !row.ok);
  return {
    ok: failed.length === 0 && rows.length > 0,
    counted: rows.length,
    passed: rows.filter((row) => row.ok).length,
    failed,
    rows,
  };
}

export function evaluateColdSuite({ routes, counters, origin, serverInfo }) {
  const matrix = evaluateMatrix({
    id: "cold-amount-matrix",
    expect: "pass",
    kind: "amount-matrix",
    routes,
    claims: {
      charged: false,
      paidDelivery: false,
      successProven: false,
      settlement: false,
      treatAbsenceAsDemand: false,
    },
    counters,
  });
  const ok = matrix.ok === true
    && Number(counters?.verify || 0) === 0
    && Number(counters?.settle || 0) === 0;
  return {
    ok,
    mode: "cold",
    artifact: "server.js",
    code: ok ? CODES.UNPAID_AMOUNT_MATRIX : matrix.code,
    origin,
    serverInfo,
    paymentSent: false,
    paymentSignatureSent: false,
    matrix,
    counters,
    routes: matrix.classified?.amounts ?? null,
    boundary: {
      paymentSent: false,
      paymentSignatureSent: false,
      liveFacilitator: false,
      published: false,
      ownerCdp: false,
    },
  };
}


