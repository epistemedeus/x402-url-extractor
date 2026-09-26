import { ABSENT_PROBES, SDS } from "./constants.mjs";
import { evaluateColdSuite, evaluateFixture, evaluateFixtureCorpus } from "./evaluate.mjs";
import { probeColdSurface, withMerchant } from "./merchant.mjs";
import { loadFixtures, loadJson, SEEDED_ROUTE_ABSENT_AS_DEMAND } from "./paths.mjs";

function asPresentFixture(hit) {
  return {
    id: "cold-present-extract",
    expect: "pass",
    kind: "http-present-402",
    request: hit.request,
    observation: hit.observation,
    claims: { charged: false, paidDelivery: false, treatAbsenceAsDemand: false, settlement: false },
    counters: { verify: 0, settle: 0 },
  };
}

function asAbsentFixture(hit, counters) {
  return {
    id: `cold-absent-${hit.probe.id}`,
    expect: "pass",
    kind: "http-route-absent",
    request: hit.request,
    observation: hit.observation,
    claims: { charged: false, paidDelivery: false, treatAbsenceAsDemand: false, listed: false, settlement: false },
    counters,
  };
}

function asCatalogFixture(catalog, route) {
  return {
    id: `cold-catalog-${route.replaceAll("/", "-")}`,
    expect: "pass",
    kind: "catalog",
    request: { route, path: route },
    observation: { items: catalog.items, actions: catalog.actions },
    claims: { treatAbsenceAsDemand: false, listed: false },
  };
}

function asSignatureFixture(hit, counters) {
  return {
    id: "cold-absent-payment-signature",
    expect: "pass",
    kind: "http-route-absent",
    request: hit.request,
    observation: hit.observation,
    claims: { charged: false, paidDelivery: false, treatAbsenceAsDemand: false, settlement: false },
    counters,
  };
}

export async function runColdSuite() {
  return withMerchant(async (session) => {
    const probed = await probeColdSurface(session);
    const counters = probed.counters;
    const report = evaluateColdSuite({
      present: asPresentFixture(probed.presentHit),
      absent: probed.absentHits.map((hit) => asAbsentFixture(hit, { verify: 0, settle: 0 })),
      catalog: [
        asCatalogFixture(probed.catalog, SDS.extractPath),
        ...ABSENT_PROBES.map((probe) => asCatalogFixture(probed.catalog, probe.path)),
      ],
      signatureAbsent: asSignatureFixture(probed.signatureHit, {
        verify: counters.verify,
        settle: counters.settle,
      }),
      counters,
      origin: probed.origin,
    });
    report.wire = {
      presentHttpStatus: probed.presentHit.observation.httpStatus,
      presentPaymentRequiredHeader: probed.presentHit.observation.hasPaymentRequiredHeader,
      absent: probed.absentHits.map((hit) => ({
        id: hit.probe.id,
        method: hit.probe.method,
        path: hit.probe.path,
        httpStatus: hit.observation.httpStatus,
        paymentRequiredHeader: hit.observation.hasPaymentRequiredHeader,
      })),
      signatureHttpStatus: probed.signatureHit.observation.httpStatus,
      catalogItemCount: probed.catalog.items.length,
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
