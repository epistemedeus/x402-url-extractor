import {
  ABSENT_ROUTE,
  CASEFOLD_DECLARED_ROUTE,
  DECLARED_FREE_ROUTE,
  DECLARED_PAID_ROUTE,
  LOOKALIKE_ROUTES,
  METHOD_ABSENT,
} from "./constants.mjs";
import { runCatalogRouteAbsent } from "./catalog.mjs";
import { evaluateColdSuite, evaluateFixtureCorpus, evaluateTrace } from "./evaluate.mjs";
import { numberAttempts, traceBoundary, withMerchant } from "./merchant.mjs";
import { loadFixtures, loadJson, SEEDED_ABSENT_AS_402 } from "./paths.mjs";

function finishTrace(session, { id, kind, route, attempts, catalog, wellKnown, expect = "pass", claims }) {
  const numbered = numberAttempts(attempts || []);
  const settleCount = numbered.reduce((sum, attempt) => sum + Number(attempt.settleDelta || 0), 0);
  const verifyCount = numbered.reduce((sum, attempt) => sum + Number(attempt.verifyDelta || 0), 0);
  return {
    id,
    expect,
    kind,
    rail: "x402",
    route: route ?? ABSENT_ROUTE,
    declaredPaidRoute: DECLARED_PAID_ROUTE,
    declaredFreeRoute: DECLARED_FREE_ROUTE,
    origin: session?.origin?.() ?? null,
    attempts: numbered,
    settleCount,
    verifyCount,
    catalog: catalog ?? null,
    wellKnown: wellKnown ?? null,
    claims: claims ?? {
      ok: true,
      routeAbsent: kind !== "http-paid-control" && kind !== "http-free-surface",
      payable: false,
      charged: false,
      settled: false,
    },
    boundary: session ? traceBoundary(session) : {
      paymentSent: false,
      liveFacilitator: false,
      checkoutMutated: false,
      published: false,
      neoTouched: false,
    },
  };
}

export async function runDeclaredPaidControl() {
  return withMerchant(async (session) => {
    const unpaid = await session.recordAttempt("paid-control-unpaid", DECLARED_PAID_ROUTE, {
      fields: { role: "paid-control", routeAbsent: false },
    });
    const casefold = await session.recordAttempt("paid-control-casefold", CASEFOLD_DECLARED_ROUTE, {
      fields: { role: "paid-control", routeAbsent: false },
    });
    return finishTrace(session, {
      id: "x402-declared-paid-control",
      kind: "http-paid-control",
      route: DECLARED_PAID_ROUTE,
      attempts: [unpaid, casefold],
      claims: { ok: true, routeAbsent: false, payable: true, charged: false, settled: false },
    });
  });
}

export async function runDeclaredFreeNotAbsent() {
  return withMerchant(async (session) => {
    const healthz = await session.recordAttempt("free-healthz", DECLARED_FREE_ROUTE, {
      fields: { role: "free-surface", routeAbsent: false, payable: false },
    });
    return finishTrace(session, {
      id: "x402-declared-free-not-absent",
      kind: "http-free-surface",
      route: DECLARED_FREE_ROUTE,
      attempts: [healthz],
      claims: { ok: true, routeAbsent: false, payable: false, charged: false, settled: false },
    });
  });
}

export async function runHttpRouteAbsent() {
  return withMerchant(async (session) => {
    const listed = await session.wellKnownRoutes();
    const absent = await session.recordAttempt("absent-unpaid", ABSENT_ROUTE, {
      fields: { role: "absent", routeAbsent: true, payable: false },
    });
    const lookalikes = [];
    for (const [index, path] of LOOKALIKE_ROUTES.entries()) {
      lookalikes.push(await session.recordAttempt(`lookalike-${index}`, path, {
        fields: { role: "absent", routeAbsent: true, payable: false },
      }));
    }
    const methodAbsent = await session.recordAttempt("method-absent-post-extract", METHOD_ABSENT.path, {
      method: METHOD_ABSENT.method,
      fields: { role: "absent", routeAbsent: true, payable: false },
    });
    const credential = await session.credential("w811_absent_sig");
    const withSignature = await session.recordAttempt("absent-with-signature", ABSENT_ROUTE, {
      headers: credential.headers,
      fields: { role: "absent", routeAbsent: true, payable: false },
    });
    return finishTrace(session, {
      id: "x402-route-absent-http",
      kind: "http-absent",
      route: ABSENT_ROUTE,
      attempts: [absent, ...lookalikes, methodAbsent, withSignature],
      wellKnown: {
        itemRoutes: listed,
        includesAbsentRoute: listed.includes(ABSENT_ROUTE),
      },
      claims: { ok: true, routeAbsent: true, payable: false, charged: false, settled: false },
    });
  });
}

export async function runCatalogScenario() {
  const catalog = await runCatalogRouteAbsent();
  return finishTrace(null, {
    id: "x402-catalog-route-absent",
    kind: "catalog-route-absent",
    route: catalog.expectedRoute,
    attempts: [],
    catalog,
    claims: {
      ok: true,
      routeAbsent: true,
      payable: false,
      charged: false,
      settled: false,
    },
  });
}

export async function runColdSuite() {
  const scenarios = [
    await runDeclaredPaidControl(),
    await runDeclaredFreeNotAbsent(),
    await runHttpRouteAbsent(),
    await runCatalogScenario(),
  ];
  const report = evaluateColdSuite(scenarios);
  report.boundary = {
    paymentSent: false,
    liveFacilitator: false,
    checkoutMutated: false,
    published: false,
    neoTouched: false,
  };
  const http = scenarios.find((row) => row.id === "x402-route-absent-http");
  const paid = scenarios.find((row) => row.id === "x402-declared-paid-control");
  report.wire = {
    paidControlHttpStatus: paid?.attempts?.[0]?.httpStatus ?? null,
    absentHttpStatus: http?.attempts?.[0]?.httpStatus ?? null,
    absentPaymentRequired: http?.attempts?.[0]?.hasPaymentRequired ?? null,
    wellKnownIncludesAbsent: http?.wellKnown?.includesAbsentRoute ?? null,
    catalogStatus: scenarios.find((row) => row.id === "x402-catalog-route-absent")?.catalog?.priceObservationStatus ?? null,
  };
  return report;
}

export function runSeededFailure(fixturePath = SEEDED_ABSENT_AS_402) {
  const fixture = loadJson(fixturePath);
  const evaluated = evaluateTrace(fixture);
  return {
    ...evaluated,
    mode: "seeded-failure",
    fixture: fixturePath,
    id: fixture.id ?? evaluated.id,
    claims: fixture.claims ?? null,
  };
}

export function runFixtureCorpus() {
  return evaluateFixtureCorpus(loadFixtures("pass"), loadFixtures("reject"));
}
