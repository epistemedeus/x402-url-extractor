import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MATRIX, SCHEMA_FIXTURE, SDS, WAVE } from "./constants.mjs";
import { FIXTURES } from "./paths.mjs";

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
  const mpp = route.path.startsWith("/commerce/") || route.path.startsWith("/chain/")
    || route.path.startsWith("/security/")
    || route.path.startsWith("/distribution/agent-surface");
  const protocol = mpp ? "x402 or MPP" : "x402";
  return `payment required (${protocol}, ${route.openapi402Token} USDC base)`;
}

export function buildObserved({ amountFor = (route) => route.amountAtomic, omitHttp = [] } = {}) {
  const http = {};
  const tools = [];
  const paths = {};
  const items = [];
  const omitted = new Set(omitHttp);

  for (const route of MATRIX) {
    const amount = amountFor(route);
    if (!omitted.has(route.path)) {
      http[route.path] = {
        status: 402,
        method: route.method,
        requestHeaders: {},
        accepts: [accept(amount)],
        offerReceiptAmount: amount,
      };
    }
    tools.push({
      name: route.mcpTool,
      _meta: {
        x402: {
          paymentRequired: true,
          accepts: [accept(amount)],
        },
      },
    });
    const verb = route.method.toLowerCase();
    paths[route.path] = {
      [verb]: {
        responses: {
          402: { description: openapi402Description(route) },
        },
        "x-payment-info": {
          price: {
            amount: route.openapiPriceAmount,
            currency: "USD",
            mode: "fixed",
          },
        },
      },
    };
    items.push({
      resource: { routeTemplate: route.path },
      accepts: [accept(amount)],
    });
  }

  return {
    http,
    mcp: { tools },
    openapi: { paths },
    wellKnownX402: { items },
  };
}

export function buildCanonicalFixture() {
  return {
    schemaVersion: SCHEMA_FIXTURE,
    wave: WAVE,
    id: "canonical-matrix",
    expect: "pass",
    unpublished: true,
    paymentAttempted: false,
    note: "String-exact unpaid amounts. Scan is 200000, tx-receipt is 2000, extract control is 5000. No unit conversion.",
    observed: buildObserved(),
  };
}

export function buildSeededExtractOntoScanFixture() {
  const fixture = buildCanonicalFixture();
  fixture.id = "seeded-extract-onto-scan";
  fixture.expect = "reject";
  fixture.note = "SEEDING FAILURE: copy GET /extract amount 5000 onto GET /scan. Scan must remain 200000.";
  fixture.claims = {
    copyExtractOntoScan: true,
    note: "SEEDING FAILURE: copy GET /extract amount 5000 onto GET /scan. Scan must remain 200000. Exit 1 amount_mismatch.",
  };
  const scanAmount = (route) => (route.id === "scan" ? "5000" : route.amountAtomic);
  fixture.observed = buildObserved({ amountFor: scanAmount });
  return fixture;
}

export function buildSeededInventedFieldFixture() {
  const fixture = buildCanonicalFixture();
  fixture.id = "seeded-invented-field";
  fixture.expect = "reject";
  fixture.note = "SEEDING FAILURE: invented loyaltyPoints / throughBlock without a live schema.";
  fixture.claims = {
    inventedReceiptFields: ["loyaltyPoints", "throughBlock"],
  };
  fixture.observed.http["/extract"].loyaltyPoints = 12;
  fixture.observed.mcp.tools[0].throughBlock = 1;
  return fixture;
}

export function buildTreatAbsenceAsDemandFixture() {
  const fixture = buildCanonicalFixture();
  fixture.id = "treat-absence-as-demand";
  fixture.expect = "reject";
  fixture.note = "SEEDING FAILURE: missing /scan treated as buyer demand.";
  fixture.claims = {
    treatAbsenceAsDemand: true,
  };
  fixture.observed = buildObserved({ omitHttp: ["/scan"] });
  return fixture;
}

export function buildSeededUnitConversionFixture() {
  const fixture = buildCanonicalFixture();
  fixture.id = "seeded-unit-conversion";
  fixture.expect = "reject";
  fixture.note = "SEEDING FAILURE: display-unit 0.20 on scan accepts[].amount instead of atomic 200000.";
  fixture.observed.http["/scan"].accepts[0].amount = "0.20";
  fixture.observed.mcp.tools.find((tool) => tool.name === "scan")._meta.x402.accepts[0].amount = "0.20";
  return fixture;
}

export const FIXTURE_BUILDERS = Object.freeze({
  "pass/canonical-matrix.json": buildCanonicalFixture,
  "reject/seeded-extract-onto-scan.json": buildSeededExtractOntoScanFixture,
  "reject/seeded-invented-field.json": buildSeededInventedFieldFixture,
  "reject/treat-absence-as-demand.json": buildTreatAbsenceAsDemandFixture,
  "reject/seeded-unit-conversion.json": buildSeededUnitConversionFixture,
});

export function writeBundledFixtures(root = FIXTURES) {
  mkdirSync(join(root, "pass"), { recursive: true });
  mkdirSync(join(root, "reject"), { recursive: true });
  const written = [];
  for (const [relative, builder] of Object.entries(FIXTURE_BUILDERS)) {
    const path = join(root, relative);
    writeFileSync(path, `${JSON.stringify(builder(), null, 2)}\n`);
    written.push(path);
  }
  return written;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  for (const path of writeBundledFixtures()) {
    process.stdout.write(`${path}\n`);
  }
}
