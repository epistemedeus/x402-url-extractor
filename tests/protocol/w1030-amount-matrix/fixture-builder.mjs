import { SCHEMA_FIXTURE, SDS, MATRIX } from "./constants.mjs";

function accept(amount) {
  return {
    scheme: SDS.scheme,
    network: SDS.network,
    asset: SDS.asset,
    amount,
    payTo: SDS.payTo,
  };
}

function openapi402Description(route) {
  if (route.id === "payment-offer-preflight" || route.id === "transaction-receipt") {
    return `payment required (x402 or MPP, ${route.openapi402Token} USDC base)`;
  }
  return `payment required (x402, ${route.openapi402Token} USDC base)`;
}

export function buildObserved({
  amountOverrides = {},
  omitPaths = [],
  openapiAmountOverrides = {},
  openapiTokenOverrides = {},
} = {}) {
  const http = {};
  const tools = [];
  const paths = {};
  const items = [];

  for (const route of MATRIX) {
    if (omitPaths.includes(route.path)) continue;
    const amount = amountOverrides[route.id] ?? route.amountAtomic;
    const openapiAmount = openapiAmountOverrides[route.id] ?? route.openapiPriceAmount;
    const openapiToken = openapiTokenOverrides[route.id] ?? route.openapi402Token;
    const synthetic = { ...route, openapi402Token: openapiToken, openapiPriceAmount: openapiAmount };

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
          accepts: [{ scheme: SDS.scheme, network: SDS.network, amount, payTo: SDS.payTo }],
        },
      },
    });
    paths[route.path] = {
      get: {
        responses: { "402": { description: openapi402Description(synthetic) } },
        "x-payment-info": { price: { amount: openapiAmount, currency: "USD", mode: "fixed" } },
      },
    };
    items.push({
      resource: { routeTemplate: route.path },
      accepts: [{ scheme: SDS.scheme, network: SDS.network, amount }],
    });
  }

  return { http, mcp: { tools }, openapi: { paths }, wellKnownX402: { items } };
}

export function buildFixture({
  id,
  expect = "pass",
  claims = undefined,
  extra = {},
  observed,
  note,
} = {}) {
  return {
    schemaVersion: SCHEMA_FIXTURE,
    wave: "w1030",
    id,
    unpublished: true,
    paymentAttempted: false,
    expect,
    ...(note ? { note } : {}),
    ...(claims ? { claims } : {}),
    ...extra,
    observed,
  };
}

export function canonicalFixture() {
  return buildFixture({
    id: "canonical-matrix",
    expect: "pass",
    note: "String-exact unpaid amounts. Scan is 200000, tx-receipt is 2000, extract control is 5000. No unit conversion.",
    observed: buildObserved(),
  });
}

export function seededExtractOntoScanFixture() {
  return buildFixture({
    id: "seeded-extract-onto-scan",
    expect: "reject",
    note: "SEEDING FAILURE: copy GET /extract amount 5000 onto GET /scan. Scan must remain 200000.",
    claims: {
      copyExtractOntoScan: true,
      note: "SEEDING FAILURE: copy GET /extract amount 5000 onto GET /scan. Scan must remain 200000. Exit 1 amount_mismatch.",
    },
    observed: buildObserved({
      amountOverrides: { scan: "5000" },
      openapiAmountOverrides: { scan: "0.005" },
      openapiTokenOverrides: { scan: "$0.005" },
    }),
  });
}

export function seededInventedFieldFixture() {
  const observed = buildObserved();
  observed.http["/extract"].accepts[0].loyaltyPoints = 42;
  return buildFixture({
    id: "seeded-invented-field",
    expect: "reject",
    note: "SEEDING FAILURE: loyaltyPoints and throughBlock are not live receipt fields.",
    extra: { loyaltyPoints: 42, throughBlock: 12345678 },
    observed,
  });
}

export function seededAbsenceAsDemandFixture() {
  return buildFixture({
    id: "seeded-absence-as-demand",
    expect: "reject",
    note: "SEEDING FAILURE: missing GET /scan is treated as buyer demand. Absence is not demand.",
    claims: {
      treatAbsenceAsDemand: true,
      note: "SEEDING FAILURE: missing GET /scan is treated as buyer demand. Absence is not demand. Exit 1.",
    },
    observed: buildObserved({ omitPaths: ["/scan"] }),
  });
}

export function seededUnitConversionFixture() {
  return buildFixture({
    id: "seeded-unit-conversion",
    expect: "reject",
    note: "SEEDING FAILURE: scan amount written as display 0.20 instead of atomic 200000.",
    observed: buildObserved({
      amountOverrides: { scan: "0.20" },
    }),
  });
}

export const FIXTURE_BUILDERS = Object.freeze({
  "canonical-matrix": canonicalFixture,
  "seeded-extract-onto-scan": seededExtractOntoScanFixture,
  "seeded-invented-field": seededInventedFieldFixture,
  "seeded-absence-as-demand": seededAbsenceAsDemandFixture,
  "seeded-unit-conversion": seededUnitConversionFixture,
});
