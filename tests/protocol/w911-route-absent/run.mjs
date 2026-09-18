import { SDS } from "./constants.mjs";
import { evaluateColdSuite, evaluateFixture, evaluateFixtureCorpus } from "./evaluate.mjs";
import { loadFixtures, loadJson, SEEDED_ROUTE_ABSENT_AS_DEMAND } from "./paths.mjs";
import {
  probeMerchantFlagOff,
  runEmptyCatalogAudit,
  runOriginFoundAudit,
  withMerchantFlagOff,
} from "./surface.mjs";

export async function runColdSuite() {
  const catalogAudit = await runEmptyCatalogAudit();
  const originFoundAudit = await runOriginFoundAudit();
  return withMerchantFlagOff(async (session) => {
    const merchant = await probeMerchantFlagOff(session);
    const report = evaluateColdSuite({
      catalogAudit,
      originFoundAudit,
      merchant,
      origin: session.origin,
    });
    report.wire = {
      catalogUnknownPriceSources: catalogAudit.summary?.unknownPriceSources || [],
      catalogIdentitySample: catalogAudit.sources?.["x402jobs-public-search"]?.identityObservation?.status || null,
      catalogPriceSample: catalogAudit.sources?.["x402jobs-public-search"]?.priceObservation?.status || null,
      originFoundFinding: (originFoundAudit.findings || [])
        .some((item) => item.finding === "origin_found_expected_route_absent"),
      originFoundPrice: originFoundAudit.sources?.["coinbase-bazaar"]?.priceObservation?.status || null,
      lockfileHttpStatus: merchant.httpStatus,
      extractHttpStatus: merchant.extractHttpStatus,
      paymentRequiredHeader: merchant.hasPaymentRequiredHeader,
      advertisedOpenApi: merchant.advertisedOpenApi,
      advertisedActions: merchant.advertisedActions,
      advertisedWellKnown: merchant.advertisedWellKnown,
      facilitatorVerify: merchant.facilitatorVerify,
      facilitatorSettle: merchant.facilitatorSettle,
      route: SDS.lockfilePath,
    };
    return report;
  });
}

export function runSeededFailure(fixturePath = SEEDED_ROUTE_ABSENT_AS_DEMAND) {
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
