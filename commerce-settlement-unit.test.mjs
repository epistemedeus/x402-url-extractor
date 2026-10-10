import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";

import Ajv from "ajv";

import {
  COMMERCE_PAYMENT_EVIDENCE_SCHEMA,
  buildCommercePaymentEvidenceReadout,
  commercePaymentEvidenceOutputSchema,
} from "./commerce-payment-evidence.mjs";
import { createCommerceSettlementReconciler, summarizeCommerceSettlementLedger } from "./commerce-settlement-reconciler.mjs";
import {
  SETTLEMENT_UNIT_SCHEMA,
  commerceSettlementUnitOutputSchema,
  projectCommerceSettlementUnit,
  unprojectedSettlementUnit,
} from "./commerce-settlement-unit.mjs";
import checkedUnitCatalog from "./commerce-settlement-unit-catalog.json" with { type: "json" };

const RECORD_SCHEMA = "samedaydesk.commerce-settlement-reconciliation.v1";
const ENTRY = checkedUnitCatalog.entries[0];
const CANARY_REF = `0x${"cd".repeat(32)}`;
const CANARY_PAYER = "payer-canary-148000";
const CANARY_TREASURY = "treasury-canary-148000";
const CANARY_EVENT = "source-event-canary-148000";
const CANARY_EMAIL = "person-canary@example.com";
const OTHER_ASSET = "0x1111111111111111111111111111111111111111";

function reference(index) {
  return `0x${index.toString(16).padStart(64, "a")}`;
}

function row(overrides = {}) {
  return {
    schemaVersion: RECORD_SCHEMA,
    state: "reconciled",
    settlementReference: reference(1),
    amountAtomic: "50000",
    network: ENTRY.network,
    asset: ENTRY.asset,
    payer: CANARY_PAYER,
    treasury: CANARY_TREASURY,
    sourceEventId: CANARY_EVENT,
    ...overrides,
  };
}

function ledger(rows) {
  return `${rows.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

function project(rows, options = {}) {
  const text = ledger(rows);
  const parentSummary = summarizeCommerceSettlementLedger(text);
  return {
    text,
    parentSummary,
    unit: projectCommerceSettlementUnit(text, { parentSummary, ...options }),
  };
}

function assertNoIdentity(value) {
  const rendered = JSON.stringify(value);
  assert.equal(rendered.includes(CANARY_REF), false);
  assert.equal(rendered.includes(CANARY_PAYER), false);
  assert.equal(rendered.includes(CANARY_TREASURY), false);
  assert.equal(rendered.includes(CANARY_EVENT), false);
  assert.equal(rendered.includes(CANARY_EMAIL), false);
  assert.equal(rendered.includes("1.132"), false);
  assert.equal(rendered.includes("0.05"), false);
  assert.equal(rendered.includes("e+"), false);
  assert.equal(rendered.includes("Infinity"), false);
}

const validateUnit = new Ajv({ allErrors: true, strict: false }).compile(commerceSettlementUnitOutputSchema());
const validateReadout = new Ajv({ allErrors: true, strict: false }).compile(commercePaymentEvidenceOutputSchema());

test("checked catalog decimals and chain id come from the recorded primary observations", () => {
  const chain = ENTRY.sources.find((source) => source.method === "eth_chainId");
  const decimals = ENTRY.sources.find((source) => source.selector === "0x313ce567");
  const symbol = ENTRY.sources.find((source) => source.selector === "0x95d89b41");
  const circle = ENTRY.sources.find((source) => source.name === "circle-usdc-contract-addresses");
  assert.equal(ENTRY.chainId, Number(BigInt(chain.observed)));
  assert.equal(ENTRY.network, `eip155:${ENTRY.chainId}`);
  assert.equal(ENTRY.decimals, Number(BigInt(decimals.observed)));
  assert.equal(circle.decimalsOnPage, false);
  assert.equal(circle.observed.includes(ENTRY.asset), true);
  assert.equal(symbol.decoded, "USDC");
  assert.equal(symbol.observed.toLowerCase().includes(Buffer.from("USDC").toString("hex")), true);
  assert.equal(ENTRY.symbol, symbol.decoded);
  const source = readFileSync(new URL("./commerce-settlement-unit.mjs", import.meta.url), "utf8");
  assert.equal(source.includes(ENTRY.asset), false);
  assert.equal(source.includes("decimals: 6"), false);
});

test("uniform writer network and asset qualify without a second money sum", () => {
  const { parentSummary, unit } = project([row({ settlementReference: CANARY_REF })]);
  assert.equal(validateUnit(unit), true, JSON.stringify(validateUnit.errors));
  assert.equal(unit.schemaVersion, SETTLEMENT_UNIT_SCHEMA);
  assert.equal(unit.decision, "qualified");
  assert.equal(unit.comparable, true);
  assert.deepEqual(unit.unit, {
    network: ENTRY.network,
    asset: ENTRY.asset,
    symbol: ENTRY.symbol,
    decimals: ENTRY.decimals,
  });
  assert.equal(unit.atomicScale, "1000000");
  assert.equal(unit.bindsToParent.amountAtomic, parentSummary.amountAtomic);
  assert.equal(unit.bindsToParent.amountAtomic, "50000");
  assert.equal(unit.bindsToParent.reconciledSettlements, 1);
  assert.equal(unit.bindsToParent.matchesSuppliedSummary, true);
  assert.equal(unit.recognizedIncomeAtomic, null);
  assert.equal(unit.customerAttribution, null);
  assert.equal(unit.boundaries.parentSummaryRemainsMoneyAuthority, true);
  assert.equal(JSON.stringify(unit).includes("\"100000\""), false);
  assertNoIdentity(unit);
});

test("v1 payment readout stays exact when a unit projection is attached beside it", () => {
  const { parentSummary, unit } = project([row()]);
  const readout = buildCommercePaymentEvidenceReadout({
    eventSnapshot: {
      paidSuccessActors: 1,
      repeatPaidSuccessActors: 0,
      requestedWindowStart: "2026-08-28T00:00:00.000Z",
      requestedWindowCoverage: "unknown_for_full_window",
    },
    settlementReconciliation: {
      enabled: true,
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      ledger: parentSummary,
      settlementUnit: unit,
    },
  });
  assert.equal(readout.schemaVersion, COMMERCE_PAYMENT_EVIDENCE_SCHEMA);
  assert.equal(validateReadout(readout), true, JSON.stringify(validateReadout.errors));
  assert.deepEqual(Object.keys(readout.settlementPlane).sort(), [
    "amountAtomic",
    "baseline",
    "byClass",
    "byRoute",
    "coverage",
    "enabled",
    "reconciledSettlements",
  ]);
  assert.equal(readout.settlementPlane.amountAtomic, "50000");
  assert.equal(readout.settlementPlane.currency, undefined);
  assert.equal(readout.settlementUnit, undefined);
  assert.equal(readout.customerPlane.attributableCustomerCount, null);
});

test("legacy rows without network or asset stay missing and ignore route and server defaults", () => {
  const text = ledger([row({
    network: undefined,
    asset: undefined,
    route: "/extract",
    settlementReference: CANARY_REF,
  })]);
  const parentSummary = summarizeCommerceSettlementLedger(text);
  const unit = projectCommerceSettlementUnit(text, {
    parentSummary,
    asset: ENTRY.asset,
    network: ENTRY.network,
    currency: "USD",
  });
  assert.equal(parentSummary.reconciledSettlements, 1);
  assert.equal(parentSummary.amountAtomic, "50000");
  assert.equal(unit.decision, "missing");
  assert.equal(unit.comparable, false);
  assert.equal(unit.unit, null);
  assert.equal(unit.atomicScale, null);
  assert.equal(unit.bindsToParent.matchesSuppliedSummary, true);
  const callerCurrency = project([row({
    network: undefined,
    asset: undefined,
    currency: "USDC",
    route: "/extract",
  })]);
  assert.equal(callerCurrency.unit.decision, "rejected");
  assert.equal(callerCurrency.unit.comparable, false);
  assert.equal(callerCurrency.unit.unit, null);
  assert.equal(callerCurrency.unit.rejectedReasons.unit_fields_without_network_asset, 1);
  assertNoIdentity(unit);
});

test("partial, conflicting, unmapped, rejected, and forged metadata do not label the parent total", () => {
  const partial = project([
    row({ settlementReference: reference(1) }),
    row({ settlementReference: reference(2), amountAtomic: "10", network: undefined, asset: undefined }),
  ]);
  assert.equal(partial.unit.decision, "partial");
  assert.equal(partial.unit.comparable, false);
  assert.equal(partial.unit.unit, null);
  assert.equal(partial.unit.coverage.qualifiedUnit, 1);
  assert.equal(partial.unit.coverage.missingUnit, 1);
  assert.equal(partial.unit.bindsToParent.amountAtomic, partial.parentSummary.amountAtomic);
  assert.equal(partial.parentSummary.amountAtomic, "50010");
  assert.equal(JSON.stringify(partial.unit).includes(ENTRY.symbol), false);

  const mixedAssets = project([
    row({ settlementReference: reference(1), amountAtomic: "2" }),
    row({ settlementReference: reference(2), amountAtomic: "3", asset: OTHER_ASSET }),
  ]);
  assert.equal(mixedAssets.unit.decision, "conflicting");
  assert.equal(mixedAssets.unit.unit, null);
  assert.equal(mixedAssets.parentSummary.amountAtomic, "5");

  const mixedNetworks = project([
    row({ settlementReference: reference(1) }),
    row({ settlementReference: reference(2), network: "eip155:1" }),
  ]);
  assert.equal(mixedNetworks.unit.decision, "conflicting");
  assert.equal(mixedNetworks.unit.comparable, false);

  const unmapped = project([row({ asset: OTHER_ASSET, network: "eip155:1" })]);
  assert.equal(unmapped.unit.decision, "unmapped");
  assert.equal(unmapped.unit.comparable, false);
  assert.equal(unmapped.unit.unit.decimals, null);
  assert.equal(unmapped.unit.unit.symbol, null);
  assert.equal(unmapped.unit.unit.network, "eip155:1");
  assert.equal(unmapped.unit.atomicScale, null);

  const forged = project([row({ decimals: 18, symbol: "USDT", currency: "USD" })]);
  assert.equal(forged.unit.decision, "rejected");
  assert.equal(forged.unit.comparable, false);
  assert.equal(forged.unit.unit, null);
  assert.equal(forged.unit.rejectedReasons.forged_decimals, 1);
  assert.equal(JSON.stringify(forged.unit).includes("USDT"), false);

  const malformed = project([row({ asset: CANARY_EMAIL, network: 8453 })]);
  assert.equal(malformed.unit.decision, "rejected");
  assert.equal(malformed.unit.rejectedReasons.malformed_network, 1);
  assertNoIdentity(malformed.unit);

  const explicitMatch = project([row({ decimals: ENTRY.decimals, symbol: ENTRY.symbol, currency: ENTRY.symbol })]);
  assert.equal(explicitMatch.unit.decision, "qualified");
  assert.equal(explicitMatch.unit.unit.decimals, ENTRY.decimals);
});

test("duplicate references follow the parent first-write and do not import the later asset", () => {
  const text = ledger([
    row({ settlementReference: CANARY_REF, amountAtomic: "50000" }),
    row({
      settlementReference: `0x${CANARY_REF.slice(2).toUpperCase()}`,
      amountAtomic: "99999",
      asset: OTHER_ASSET,
      network: "eip155:1",
    }),
  ]);
  const parentSummary = summarizeCommerceSettlementLedger(text);
  const unit = projectCommerceSettlementUnit(text, { parentSummary });
  assert.equal(parentSummary.reconciledSettlements, 1);
  assert.equal(parentSummary.amountAtomic, "50000");
  assert.equal(unit.decision, "qualified");
  assert.equal(unit.coverage.duplicateReferencesIgnored, 1);
  assert.equal(unit.bindsToParent.amountAtomic, "50000");
  assertNoIdentity(unit);
});

test("a stale or non-string parent summary cannot qualify the walked cut", () => {
  const text = ledger([row()]);
  const parentSummary = summarizeCommerceSettlementLedger(text);
  const stale = projectCommerceSettlementUnit(text, {
    parentSummary: { ...parentSummary, amountAtomic: "1" },
  });
  assert.equal(stale.decision, "stale_cut");
  assert.equal(stale.comparable, false);
  assert.equal(stale.unit, null);
  assert.equal(stale.atomicScale, null);
  assert.equal(stale.bindsToParent.matchesSuppliedSummary, false);
  assert.equal(stale.bindsToParent.amountAtomic, parentSummary.amountAtomic);

  const numeric = projectCommerceSettlementUnit(text, {
    parentSummary: { ...parentSummary, amountAtomic: 50000 },
  });
  assert.equal(numeric.decision, "stale_cut");
  assert.equal(numeric.unit, null);

  const unreadable = projectCommerceSettlementUnit(null, { parentSummary });
  assert.equal(unreadable.decision, "unreadable");
  assert.equal(unreadable.comparable, false);
  assert.equal(validateUnit(unreadable), true, JSON.stringify(validateUnit.errors));
});

test("empty cuts, rejected rows, invalid lines, and overflow stay exact strings", () => {
  const empty = projectCommerceSettlementUnit("", {
    parentSummary: summarizeCommerceSettlementLedger(""),
  });
  assert.equal(empty.decision, "empty");
  assert.equal(empty.comparable, false);
  assert.equal(empty.bindsToParent.amountAtomic, "0");
  assert.equal(empty.bindsToParent.reconciledSettlements, 0);
  assert.equal(empty.unit, null);

  const pending = project([row({ state: "pending" })]);
  assert.equal(pending.parentSummary.reconciledSettlements, 0);
  assert.equal(pending.unit.decision, "empty");

  const huge = "9".repeat(50);
  const overflow = project([row({ amountAtomic: huge })]);
  assert.equal(overflow.parentSummary.amountAtomic, huge);
  assert.equal(overflow.unit.decision, "qualified");
  assert.equal(overflow.unit.bindsToParent.amountAtomic, huge);
  assert.equal(typeof overflow.unit.bindsToParent.amountAtomic, "string");
  assert.equal(JSON.parse(JSON.stringify(overflow.unit)).bindsToParent.amountAtomic, huge);
  assertNoIdentity(overflow.unit);

  const noisy = `${ledger([row()])}{\n[]\n${JSON.stringify(row({ state: "observed", settlementReference: reference(4) }))}\n`;
  const noisySummary = summarizeCommerceSettlementLedger(noisy);
  const noisyUnit = projectCommerceSettlementUnit(noisy, { parentSummary: noisySummary });
  assert.equal(noisySummary.invalidLines, 1);
  assert.equal(noisySummary.reconciledSettlements, 1);
  assert.equal(noisyUnit.decision, "qualified");
  assert.equal(noisyUnit.coverage.invalidLines, 1);
  assert.equal(noisyUnit.bindsToParent.amountAtomic, noisySummary.amountAtomic);
});

test("reclassification of payment class does not stale a matching amount", () => {
  const text = ledger([row({ sourceEventId: "event-owned-canary", paymentClass: "unclassified" })]);
  const parentSummary = summarizeCommerceSettlementLedger(text, {
    paymentClassBySourceEventId: new Map([["event-owned-canary", "internal"]]),
  });
  const unit = projectCommerceSettlementUnit(text, { parentSummary });
  assert.equal(parentSummary.byClass.internal.amountAtomic, "50000");
  assert.equal(unit.decision, "qualified");
  assert.equal(unit.bindsToParent.matchesSuppliedSummary, true);
  assert.equal(JSON.stringify(unit).includes("event-owned-canary"), false);
});

test("status projects the same ledger bytes the parent summary admits", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "settlement-unit-148000-"));
  try {
    const text = ledger([
      row({ settlementReference: reference(1), amountAtomic: "50000" }),
      row({ settlementReference: reference(2), amountAtomic: "10", network: undefined, asset: undefined }),
    ]);
    const reconciler = createCommerceSettlementReconciler({
      actorSecret: "",
      client: {},
      dataDir: dir,
      eventPaths: [],
      network: "eip155:8453",
      asset: ENTRY.asset,
      treasury: "",
    });
    await writeFile(reconciler.ledgerPath, text);
    const status = await reconciler.status();
    assert.equal(status.ledger.amountAtomic, "50010");
    assert.equal(status.ledger.reconciledSettlements, 2);
    assert.equal(status.settlementUnit.decision, "partial");
    assert.equal(status.settlementUnit.comparable, false);
    assert.equal(status.settlementUnit.bindsToParent.amountAtomic, status.ledger.amountAtomic);
    assert.equal(status.settlementUnit.unit, null);
    assert.equal(JSON.stringify(status.settlementUnit).includes(ENTRY.symbol), false);
    const legacyOnly = ledger([row({ network: undefined, asset: undefined })]);
    await writeFile(reconciler.ledgerPath, legacyOnly);
    const legacy = await reconciler.status();
    assert.equal(legacy.ledger.amountAtomic, "50000");
    assert.equal(legacy.settlementUnit.decision, "missing");
    assert.equal(legacy.enabled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("absent projection and direct JSON round trip stay schema valid", () => {
  const absent = unprojectedSettlementUnit();
  assert.equal(absent.decision, "absent");
  assert.equal(validateUnit(absent), true, JSON.stringify(validateUnit.errors));
  const { unit } = project([row()]);
  assert.deepEqual(JSON.parse(JSON.stringify(unit)), unit);
  const handler = readFileSync(new URL("./server.js", import.meta.url), "utf8");
  assert.match(handler, /settlementUnit: commerceSettlementUnitOutputSchema\(\)/);
  assert.match(handler, /const settlementUnit = settlementReconciliation\.settlementUnit \?\? unprojectedSettlementUnit\(\)/);
  assert.match(handler, /paymentEvidence, settlementReconciliation, settlementUnit/);
});

test("lowercase asset still matches the checked catalog entry", () => {
  const { unit } = project([row({ asset: ENTRY.asset.toLowerCase() })]);
  assert.equal(unit.decision, "qualified");
  assert.equal(unit.unit.asset, ENTRY.asset);
});
