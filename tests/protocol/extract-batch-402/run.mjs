import { evaluateCold, evaluateFixtureCorpus, evaluateObservation } from "./evaluate.mjs";
import { loadFixtures, loadJson, SEEDED_REWRITE } from "./paths.mjs";
import { probeCold } from "./probe.mjs";

export async function runCold(options = {}) {
  const observation = await probeCold(options);
  const report = evaluateCold(observation);
  report.probe = {
    origin: observation.request.url,
    httpStatus: observation.httpStatus,
    openapi402: observation.openapi?.paymentRequiredDescription ?? null,
    wellKnown: {
      method: observation.wellKnown?.requestMethod ?? null,
      routeTemplate: observation.wellKnown?.routeTemplate ?? null,
      amount: observation.wellKnown?.amount ?? null,
      extractGetAmount: observation.wellKnown?.extractGetAmount ?? null,
    },
    mcp: {
      extract_batch: observation.mcp?.extract_batch ?? null,
      extract: observation.mcp?.extract ?? null,
    },
    paymentRequiredHeader: observation.responseHeaders?.["payment-required"] === "present",
    paymentResponseHeader: Boolean(observation.responseHeaders?.["payment-response"]),
  };
  return report;
}

export function runSeededFailure(fixturePath = SEEDED_REWRITE) {
  const fixture = loadJson(fixturePath);
  const evaluated = evaluateObservation(fixture);
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
