import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { COMMERCE_PAYMENT_EVIDENCE_SCHEMA } from "./commerce-payment-evidence.mjs";
import { SETTLEMENT_SOURCE_DELIVERY_SUMMARY_SCHEMA } from "./commerce-events.mjs";
import {
  R02_SELLER_INTEGRITY_PIN,
  SELLER_INTEGRITY_EVENT_RECONCILE_SCHEMA,
  SellerIntegrityReconcileError,
  reconcileSellerIntegrityEvent,
  runSellerIntegrityReconcileCli,
} from "./seller-integrity-event-reconcile.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PINNED = join(ROOT, "fixtures/seller-integrity-event-reconcile/r02-pinned-search.json");
const INVENTED = join(ROOT, "fixtures/seller-integrity-event-reconcile/invented-bank.json");
const OPERATION_ID = "0a4d081d-18f6-4135-a412-4ddc1754c816";
const REFERENCE = `0x${"ab".repeat(32)}`;
const HIDDEN_PAYER = "0x1111111111111111111111111111111111111111";

function pinnedCatalog(overrides = {}) {
  const body = JSON.parse(readFileSync(PINNED, "utf8"));
  return {
    ...body,
    ...overrides,
    resources: overrides.resources || body.resources,
  };
}

function ledgerRow(overrides = {}) {
  return {
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    state: "reconciled",
    sourceEventId: "event-seller",
    route: "/commerce/seller-integrity-audit",
    paymentClass: "validation",
    settlementReference: REFERENCE,
    amountAtomic: "10000",
    ...overrides,
  };
}

function ndjson(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function assertUnknownCatalog(report) {
  assert.equal(report.schemaVersion, SELLER_INTEGRITY_EVENT_RECONCILE_SCHEMA);
  assert.equal(report.bank, false);
  assert.equal(report.doNotBank, true);
  assert.equal(report.bankedRevenueInvented, false);
  assert.equal(report.bankedRevenueUsdc, null);
  assert.equal(report.catalogEqualsRevenue, false);
  assert.equal(report.attributable, "unknown");
  assert.equal(report.attribution.external, 0);
  assert.equal(report.attribution.owner_qa, 0);
  assert.equal(report.attribution.unknown, 3);
  assert.equal(report.attribution.payerIdentityJoinedToCatalog, false);
  assert.equal(report.catalog.calls, 3);
  assert.equal(report.catalog.payers, 3);
  assert.equal(report.catalog.lastCalledAt, "2026-09-28T06:02:21.396Z");
  assert.equal(report.catalog.amountAtomic, "10000");
  assert.equal(report.catalog.label, "catalog-aggregate-unverified");
  assert.equal(report.paymentEvidence.schemaVersion, COMMERCE_PAYMENT_EVIDENCE_SCHEMA);
  assert.equal(report.paymentEvidence.attributableCustomerCount, null);
  assert.equal(report.paymentEvidence.retainedPaidSuccessActors, null);
  assert.equal(report.paymentEvidence.customerAttributionRequiresSeparateEvidence, true);
  assert.equal(report.delivery.schemaVersion, SETTLEMENT_SOURCE_DELIVERY_SUMMARY_SCHEMA);
  assert.equal(report.delivery.customerDemand, "unknown");
  assert.equal(report.delivery.buyerValidOutput, "unknown");
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.catalogCountersAreRevenue, false);
  assert.equal(JSON.stringify(report).includes("10.955"), false);
  assert.equal(JSON.stringify(report).includes("0.030000"), false);
  assert.equal(JSON.stringify(report).includes(HIDDEN_PAYER), false);
}

test("pinned R02 catalog counters stay unknown and unbanked", () => {
  const report = reconcileSellerIntegrityEvent({
    catalog: pinnedCatalog(),
    operationId: OPERATION_ID,
  });
  assertUnknownCatalog(report);
  assert.equal(report.operationId, OPERATION_ID);
  assert.equal(report.catalog.descriptionLength, R02_SELLER_INTEGRITY_PIN.descriptionLength);
  assert.equal(report.catalog.descriptionOver500, false);
  assert.equal(report.catalog.featuredPresent, false);
  assert.equal(report.r02.pilotPull, 238);
  assert.equal(report.r02.commit, R02_SELLER_INTEGRITY_PIN.commit);
  assert.equal(report.r02.matchesPin, true);
  assert.equal(report.r02.pilotTreeWriteOwner, "S05-R02-INTEGRATE-0930");
  assert.equal(report.settlement.supplied, false);
  assert.equal(report.settlement.amountAtomic, null);
  assert.equal(report.settlement.routeAmountAtomic, null);
  assert.equal(report.delivery.originClass, "unknown");
  assert.equal(report.paymentEvidence.relationship, "unknown");
  assert.deepEqual(report.tools, [
    "summarizeSettlementSourceDelivery",
    "buildCommercePaymentEvidenceReadout",
  ]);
});

test("a matching reconciled count is still not the catalog's three payers", () => {
  const ledger = ndjson([
    ledgerRow({ sourceEventId: "event-1", settlementReference: `0x${"11".repeat(32)}` }),
    ledgerRow({
      sourceEventId: "event-2",
      settlementReference: `0x${"22".repeat(32)}`,
      paymentClass: "independent",
    }),
    ledgerRow({
      sourceEventId: "event-3",
      settlementReference: `0x${"33".repeat(32)}`,
      paymentClass: "unclassified",
    }),
    ledgerRow({
      sourceEventId: "event-other",
      route: "/extract",
      settlementReference: `0x${"44".repeat(32)}`,
      amountAtomic: "5000",
      paymentClass: "internal",
    }),
    {
      schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
      state: "pending",
      route: "/commerce/seller-integrity-audit",
      paymentClass: "independent",
      settlementReference: REFERENCE,
      amountAtomic: "999999",
    },
  ]);
  const report = reconcileSellerIntegrityEvent({
    catalog: pinnedCatalog(),
    ledgerContents: ledger,
    operationId: OPERATION_ID,
  });
  assertUnknownCatalog(report);
  assert.equal(report.settlement.supplied, true);
  assert.equal(report.settlement.reconciledSettlements, 4);
  assert.equal(report.settlement.routeReconciledSettlements, 3);
  assert.equal(report.settlement.routeAmountAtomic, "30000");
  assert.equal(report.settlement.numericalCountMatch, true);
  assert.equal(report.settlement.labelsAreCatalogPayers, false);
  assert.deepEqual(report.settlement.attributableLabels, {
    external: 1,
    owner_qa: 1,
    unknown: 1,
  });
  assert.equal(report.catalogEqualsRevenue, false);
  assert.equal(report.bankedRevenueUsdc, null);
  assert.equal(report.tools.includes("summarizeCommerceSettlementLedger"), true);
  assert.equal(JSON.stringify(report).includes(REFERENCE), false);
  assert.equal(JSON.stringify(report).includes("999999"), false);
});

test("an external delivery origin does not label the catalog payers", () => {
  const report = reconcileSellerIntegrityEvent({
    catalog: pinnedCatalog(),
    deliveryEvent: {
      originClass: "external",
      status: 200,
      result: "paid_success",
    },
  });
  assert.equal(report.attributable, "unknown");
  assert.equal(report.attribution.unknown, 3);
  assert.equal(report.delivery.originClass, "external");
  assert.equal(report.delivery.originVerification, "unverified");
  assert.equal(report.delivery.customerDemand, "unknown");
  assert.equal(report.delivery.originClassDoesNotLabelCatalogPayers, true);
  assert.equal(report.bankedRevenueInvented, false);
});

test("hidden payer names inside quality do not become attribution or output", () => {
  const catalog = pinnedCatalog();
  catalog.resources[0].quality = {
    ...catalog.resources[0].quality,
    payers: [HIDDEN_PAYER],
  };
  const report = reconcileSellerIntegrityEvent({ catalog });
  assertUnknownCatalog(report);
});

test("seeded bank, external label, join, and invalid payer class are refused", () => {
  const invented = JSON.parse(readFileSync(INVENTED, "utf8"));
  assert.throws(
    () => reconcileSellerIntegrityEvent({ catalog: invented }),
    (error) => error instanceof SellerIntegrityReconcileError && error.code === "invented_banked_revenue",
  );
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog({ attributable: "external" }),
    }),
    (error) => error.code === "attribution_without_identity",
  );
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog({ claim: { bankedRevenueUsdc: "0" } }),
    }),
    (error) => error.code === "invented_banked_revenue",
  );
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog({ claim: { attributable: "owner_qa" } }),
    }),
    (error) => error.code === "attribution_without_identity",
  );
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog({ claim: { joinCatalogPayers: true } }),
    }),
    (error) => error.code === "catalog_payers_are_not_identities",
  );
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog(),
      payerClasses: [{ address: HIDDEN_PAYER, class: "organic" }],
    }),
    (error) => error.code === "invalid_payer_class" && !error.message.includes(HIDDEN_PAYER),
  );
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog(),
      payerClasses: [{ address: HIDDEN_PAYER, class: "independent" }],
    }),
    (error) => error.code === "catalog_payers_are_not_identities" && !error.message.includes(HIDDEN_PAYER),
  );
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog(),
      bankedRevenueUsdc: "10.955",
    }),
    (error) => error.code === "invented_banked_revenue",
  );
});

test("partial, missing quality, and a second resource stay unbounded", () => {
  assert.throws(
    () => reconcileSellerIntegrityEvent({
      catalog: pinnedCatalog({ partialResults: true }),
    }),
    (error) => error.code === "catalog_unbounded",
  );
  const missing = pinnedCatalog();
  delete missing.resources[0].quality;
  assert.throws(
    () => reconcileSellerIntegrityEvent({ catalog: missing }),
    (error) => error.code === "catalog_quality_missing",
  );
  const doubled = pinnedCatalog();
  doubled.resources.push(structuredClone(doubled.resources[0]));
  assert.throws(
    () => reconcileSellerIntegrityEvent({ catalog: doubled }),
    (error) => error.code === "catalog_unbounded",
  );
});

test("the CLI reports the pinned catalog and rejects the seeded bank claim", async () => {
  const lines = [];
  const code = await runSellerIntegrityReconcileCli([
    "--catalog",
    "fixtures/seller-integrity-event-reconcile/r02-pinned-search.json",
    "--operation-id",
    OPERATION_ID,
  ], {
    cwd: ROOT,
    stdout: (value) => lines.push(String(value)),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const report = JSON.parse(lines.join("\n"));
  assertUnknownCatalog(report);
  assert.equal(report.r02.matchesPin, true);

  const child = spawn(process.execPath, [
    "seller-integrity-event-reconcile.mjs",
    "--catalog",
    "fixtures/seller-integrity-event-reconcile/invented-bank.json",
    "--operation-id",
    OPERATION_ID,
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const refused = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
  assert.equal(refused.stdout, "");
  assert.equal(refused.exitCode, 1);
  const errorLine = refused.stderr.trim().split("\n").find((line) => line.startsWith("{"));
  const error = JSON.parse(errorLine);
  assert.equal(error.ok, false);
  assert.equal(error.code, "invented_banked_revenue");
  assert.equal(error.bankedRevenueInvented, false);
  assert.equal(error.message.includes("0.030000"), false);
});
