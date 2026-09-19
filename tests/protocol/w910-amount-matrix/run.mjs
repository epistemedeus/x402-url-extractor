import { SDS } from "./constants.mjs";
import { evaluateColdSuite, evaluateFixture, evaluateFixtureCorpus } from "./evaluate.mjs";
import { loadFixtures, loadJson, SEEDED_AMOUNT_MISMATCH } from "./paths.mjs";
import { withUnpaidAmountMatrixSurface } from "./surface.mjs";

export async function runColdSuite() {
  return withUnpaidAmountMatrixSurface(async (session) => {
    const report = evaluateColdSuite({
      routes: session.routes,
      counters: session.snapshot(),
      origin: session.origin,
      serverInfo: session.initialized.json?.result?.serverInfo ?? {
        name: SDS.serviceName,
        version: "test-w910-amount-matrix",
      },
    });
    report.wire = {
      initializeHttpStatus: session.initialized.status,
      toolsListHttpStatus: session.listed.status,
      toolsListToolCount: Array.isArray(session.listed.json?.result?.tools)
        ? session.listed.json.result.tools.length
        : 0,
      http: Object.fromEntries(session.routes.map((route) => [
        route.routeId,
        {
          status: route.observation.http.httpStatus,
          amount: route.observation.http.amount,
          paymentRequiredHeader: route.observation.http.hasPaymentRequiredHeader,
        },
      ])),
      mcp: Object.fromEntries(session.routes.map((route) => [
        route.routeId,
        {
          tool: route.observation.mcp.tool,
          amount: route.observation.mcp.amount,
          paymentRequired: route.observation.mcp.paymentRequired,
        },
      ])),
      openapi: Object.fromEntries(session.routes.map((route) => [
        route.routeId,
        {
          priceUsd: route.observation.openapi.priceUsd,
          description402: route.observation.openapi.description402,
        },
      ])),
      wellKnown: Object.fromEntries(session.routes.map((route) => [
        route.routeId,
        { amount: route.observation.wellKnown.amount, present: route.observation.wellKnown.present },
      ])),
      paymentRequiredHeaderOnList: session.listed.hasPaymentRequiredHeader,
    };
    return report;
  });
}

export function runSeededFailure(fixturePath = SEEDED_AMOUNT_MISMATCH) {
  const fixture = loadJson(fixturePath);
  const evaluated = evaluateFixture(fixture);
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
