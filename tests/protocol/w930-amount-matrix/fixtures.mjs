import {
  EXTRACT_AMOUNT_ATOMIC,
  MATRIX,
  SCAN_AMOUNT_ATOMIC,
  SCHEMA_FIXTURE,
  SDS,
} from "./constants.mjs";

function accept(amount) {
  return {
    scheme: SDS.scheme,
    network: SDS.network,
    asset: SDS.asset,
    amount,
    payTo: SDS.payTo,
  };
}

function openapi402Text(route) {
  const dual = route.path.startsWith("/commerce/") || route.path.startsWith("/chain/");
  const protocol = dual ? "x402 or MPP" : "x402";
  return `payment required (${protocol}, ${route.openapi402Token} USDC base)`;
}

export function buildCanonicalObserved(amountFor = (route) => route.amountAtomic) {
  const http = {};
  const tools = [];
  const paths = {};
  const items = [];
  for (const route of MATRIX) {
    const amount = amountFor(route);
    http[route.path] = {
      status: 402,
      method: "GET",
      requestHeaders: {},
      accepts: [accept(amount)],
      offerReceiptAmount: amount,
    };
    tools.push({
      name: route.mcpTool,
      _meta: {
        x402: {
          paymentRequired: true,
          accepts: [accept(amount)],
        },
      },
    });
    paths[route.path] = {
      get: {
        responses: {
          "402": { description: openapi402Text(route) },
        },
        "x-payment-info": {
          price: { amount: route.openapiPriceAmount, currency: "USD", mode: "fixed" },
        },
      },
    };
    items.push({
      resource: { routeTemplate: route.path },
      accepts: [accept(amount)],
    });
  }
  return { http, mcp: { tools }, openapi: { paths }, wellKnownX402: { items } };
}

export function buildCanonicalFixture() {
  return {
    schemaVersion: SCHEMA_FIXTURE,
    id: "canonical-matrix",
    wave: "w930",
    unpublished: true,
    paymentAttempted: false,
    note: "String-exact unpaid amounts. Scan is 200000, tx-receipt is 2000, extract control is 5000. No unit conversion.",
    observed: buildCanonicalObserved(),
  };
}

export function buildSeededExtractOntoScanFixture() {
  const observed = buildCanonicalObserved((route) => (
    route.id === "scan" ? EXTRACT_AMOUNT_ATOMIC : route.amountAtomic
  ));
  return {
    schemaVersion: SCHEMA_FIXTURE,
    id: "seeded-extract-onto-scan",
    wave: "w930",
    unpublished: true,
    paymentAttempted: false,
    claims: {
      copyExtractOntoScan: true,
      note: `SEEDING FAILURE: copy GET /extract amount ${EXTRACT_AMOUNT_ATOMIC} onto GET /scan. Scan must remain ${SCAN_AMOUNT_ATOMIC}. Exit 1 amount_mismatch.`,
    },
    observed,
  };
}

export function buildSeededInventedFieldFixture() {
  const fixture = buildCanonicalFixture();
  fixture.id = "seeded-invented-field";
  fixture.note = "SEEDING FAILURE: loyaltyPoints and throughBlock are not live receipt fields.";
  fixture.loyaltyPoints = 42;
  fixture.throughBlock = 12345678;
  fixture.observed.http["/extract"].accepts[0].loyaltyPoints = 42;
  return fixture;
}

export function buildTreatAbsenceAsDemandFixture() {
  const fixture = buildCanonicalFixture();
  fixture.id = "treat-absence-as-demand";
  fixture.note = "SEEDING FAILURE: missing GET /scan is treated as buyer demand. Absence is not demand.";
  fixture.claims = {
    treatAbsenceAsDemand: true,
    note: "SEEDING FAILURE: missing GET /scan is treated as buyer demand. Absence is not demand. Exit 1.",
  };
  delete fixture.observed.http["/scan"];
  fixture.observed.mcp.tools = fixture.observed.mcp.tools.filter((tool) => tool.name !== "scan");
  delete fixture.observed.openapi.paths["/scan"];
  fixture.observed.wellKnownX402.items = fixture.observed.wellKnownX402.items
    .filter((item) => item.resource.routeTemplate !== "/scan");
  return fixture;
}

export const BUILTIN_FIXTURES = Object.freeze({
  canonical: buildCanonicalFixture,
  "seeded-extract-onto-scan": buildSeededExtractOntoScanFixture,
  "seeded-invented-field": buildSeededInventedFieldFixture,
  "treat-absence-as-demand": buildTreatAbsenceAsDemandFixture,
});
