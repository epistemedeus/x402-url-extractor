import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  admitVendorBudgetImpactRequest,
  executeVendorBudgetImpact,
  formatVendorBudgetImpactResult,
  isVendorBudgetImpactEnabled,
  isVendorBudgetUnsignedDiscoveryProbe,
  ownedVendorBudgetWorkerCount,
  vendorBudgetImpactFailureDelivery,
  vendorBudgetImpactOutputExample,
  vendorBudgetImpactOutputSchema,
  VendorBudgetImpactInputError,
} from "./vendor-budget-impact.mjs";
import {
  VENDOR_BUDGET_IMPACT_CATALOG_SHA,
  VENDOR_BUDGET_IMPACT_DESCRIPTION,
  VENDOR_BUDGET_IMPACT_ENGINE_SHA,
  VENDOR_BUDGET_IMPACT_PATH,
  VENDOR_BUDGET_IMPACT_PAYMENT_PROTOCOLS,
  VENDOR_BUDGET_IMPACT_PRICE_USD,
  VENDOR_BUDGET_IMPACT_QUOTE_MEANING,
} from "./vendor-budget-impact-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures/vendor-budget-impact", name), "utf8"));
const callerBefore = fixture("caller-before.json");
const callerAfter = fixture("caller-after.json");
const callerNochange = fixture("caller-after-nochange.json");
const callerPrice = fixture("caller-after-price.json");
const unitBefore = fixture("unit-before.json");
const unitAfter = fixture("unit-after.json");
const sampleBefore = fixture("sample-before.json");
const validateOutput = new Ajv2020({ strict: false, allErrors: true }).compile(vendorBudgetImpactOutputSchema());

function assertOutput(result) {
  assert.equal(validateOutput(result), true, JSON.stringify(validateOutput.errors));
}

test("flag stays off unless explicitly enabled", () => {
  assert.equal(isVendorBudgetImpactEnabled({}), false);
  assert.equal(isVendorBudgetImpactEnabled({ VENDOR_BUDGET_IMPACT_ENABLED: "0" }), false);
  assert.equal(isVendorBudgetImpactEnabled({ VENDOR_BUDGET_IMPACT_ENABLED: "1" }), true);
  assert.equal(VENDOR_BUDGET_IMPACT_PATH, "/vendor-budget-impact");
  assert.equal(VENDOR_BUDGET_IMPACT_PRICE_USD, "$0.005");
  assert.deepEqual([...VENDOR_BUDGET_IMPACT_PAYMENT_PROTOCOLS], ["x402"]);
  assert.match(VENDOR_BUDGET_IMPACT_QUOTE_MEANING, /x402/i);
  assert.match(VENDOR_BUDGET_IMPACT_QUOTE_MEANING, /customer-x402/);
  assert.doesNotMatch(VENDOR_BUDGET_IMPACT_QUOTE_MEANING, /owed/i);
  assert.match(VENDOR_BUDGET_IMPACT_DESCRIPTION, /customer-x402/);
  assert.ok([...VENDOR_BUDGET_IMPACT_DESCRIPTION].length <= 500);
  assert.equal(VENDOR_BUDGET_IMPACT_ENGINE_SHA, "b23260e6a2b74452075f73da1631da24d8ae6906");
  assert.equal(VENDOR_BUDGET_IMPACT_CATALOG_SHA, "dacb9950ef3e1ffcf9151c30324fe1f1cb209e19");
  assert.doesNotMatch(VENDOR_BUDGET_IMPACT_QUOTE_MEANING, /D26|EC2/i);
  const readme = readFileSync(join(here, "README.md"), "utf8");
  assert.match(readme, /https:\/\/agents\.samedaydesk\.com\/vendor-budget-impact/);
  assert.doesNotMatch(readme, /vendor-budget MCP tool's challenge\s+resource is `https:\/\/agents\.samedaydesk\.com\/extract\/batch`/);
  const adapter = readFileSync(join(here, "vendor-budget-impact.mjs"), "utf8");
  assert.match(adapter, /HTTP 200 is not used for timeout/);
  assert.match(adapter, /x402 execute-before-settle/);
});

test("only unsigned absent or empty-object bodies are discovery probes", () => {
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({ headers: {}, body: {} }), true);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({ headers: {} }), true);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({ headers: {}, body: null }), false);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({ headers: {}, body: { url: "https://example.test" } }), false);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({ headers: {}, body: { command: "node" } }), false);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({
    headers: {},
    body: { before: callerBefore, after: callerAfter },
  }), false);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({
    headers: { "payment-signature": "x" },
    body: {},
  }), false);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({
    headers: {},
    body: { before: callerBefore },
  }), false);
  assert.equal(isVendorBudgetUnsignedDiscoveryProbe({
    headers: {},
    body: [],
  }), false);
});

test("admits JSON pricing-row objects and refuses paths, URLs, commands, and extra fields", () => {
  const admitted = admitVendorBudgetImpactRequest({ before: callerBefore, after: callerAfter });
  assert.equal(admitted.before.snapshot.rows.length, 2);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: "./prices.json", after: callerAfter }), /filesystem/);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: "https://example.com/prices.json", after: callerAfter }), /filesystem|URL/);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: callerBefore, after: callerAfter, command: "node" }), /commands/);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: callerBefore, after: callerAfter, extra: true }), /unexpected field/);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: callerBefore, after: callerAfter, timeoutMs: 60_000 }), /raise admission limits/);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: callerBefore }), /required/);
});

test("unsupported and malformed snapshots refuse before any compare", () => {
  const html = readFileSync(join(here, "fixtures/vendor-budget-impact/unsupported-page.html"), "utf8");
  assert.throws(() => admitVendorBudgetImpactRequest({ before: html, after: callerAfter }), (error) => {
    assert.equal(error instanceof VendorBudgetImpactInputError, true);
    assert.equal(error.code, "html-input");
    assert.equal(error.status, 400);
    return true;
  });
  assert.throws(() => admitVendorBudgetImpactRequest({ before: sampleBefore, after: callerAfter }), /unexpected field/);
  assert.throws(() => admitVendorBudgetImpactRequest({
    before: { label: "SAMPLE", rows: callerBefore.rows },
    after: callerAfter,
  }), /SAMPLE/);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: { rows: [] }, after: callerAfter }), /zero rows/);
  assert.throws(() => admitVendorBudgetImpactRequest({
    before: { rows: [{ field: "x", value: "2", unit: "USD" }] },
    after: callerAfter,
  }), /finite number/);
  assert.throws(() => admitVendorBudgetImpactRequest({ before: "{", after: callerAfter }), /not JSON|parse-error/);
});

test("useful delta, informational no-change, and unit change stay distinct from crashes", async () => {
  const delta = await executeVendorBudgetImpact({
    input: { before: callerBefore, after: callerAfter },
    inProcess: true,
  });
  assertOutput(delta);
  assert.equal(delta.ok, true);
  assert.equal(delta.charged, true);
  assert.equal(delta.analysis, "actionable");
  assert.equal(delta.transport, "ok");
  assert.equal(delta.engine.purchaseAuthority, false);
  assert.equal(delta.engine.paidValueClaim, false);
  assert.equal(delta.engine.settlement, "nonsettling-prototype");
  assert.equal(Object.hasOwn(delta, "sold"), false);
  assert.ok(delta.engine.counts.fieldChanges >= 1);
  assert.ok(delta.engine.counts.added >= 1);
  const inputChange = delta.engine.fieldChanges.find((row) => row.fieldKey === "desk-chat-input");
  assert.equal(inputChange.beforeValue, 1);
  assert.equal(inputChange.afterValue, 1.5);
  assert.ok(delta.engine.added.some((row) => row.fieldKey === "desk-embed"));
  assert.equal(delta.engineProvenance.sha, VENDOR_BUDGET_IMPACT_ENGINE_SHA);
  assert.equal(ownedVendorBudgetWorkerCount(), 0);

  const same = await executeVendorBudgetImpact({
    input: { before: callerBefore, after: callerNochange },
    inProcess: true,
  });
  assertOutput(same);
  assert.equal(same.ok, true);
  assert.equal(same.analysis, "informational");
  assert.equal(same.engine.counts.fieldChanges, 0);
  assert.equal(same.engine.counts.added, 0);

  const price = await executeVendorBudgetImpact({
    input: { before: callerBefore, after: callerPrice },
    inProcess: true,
  });
  assert.equal(price.analysis, "actionable");
  const priceChange = price.engine.fieldChanges.find((row) => row.fieldKey === "desk-chat-input");
  assert.equal(priceChange.afterValue, 2.5);
  assert.notEqual(priceChange.afterValue, inputChange.afterValue);

  const units = await executeVendorBudgetImpact({
    input: { before: unitBefore, after: unitAfter },
    inProcess: true,
  });
  assertOutput(units);
  assert.equal(units.analysis, "partial");
  assert.equal(units.engine.counts.unitChanges, 1);
  assert.equal(units.engine.unitChanges[0].fieldKey, "grok-4.6-input");
  assert.equal(units.engine.unitChanges[0].numericComparison, "not-applicable-across-units");
});

test("timeout and crash envelopes are not informational no-change", () => {
  const timed = formatVendorBudgetImpactResult(null, null, { charged: false, transport: "timeout", wallMs: 12, admittedBodyBytes: 100 });
  assertOutput(timed);
  assert.equal(timed.ok, false);
  assert.equal(timed.charged, false);
  assert.equal(timed.analysis, "not-run");
  assert.equal(timed.transport, "timeout");
  assert.equal(timed.engine, null);

  const crashed = formatVendorBudgetImpactResult(null, null, { charged: false, transport: "engine-crash" });
  assertOutput(crashed);
  assert.equal(crashed.analysis, "not-run");
  assert.notEqual(crashed.analysis, "informational");

  assert.equal(vendorBudgetImpactFailureDelivery().status, 503);
  assert.equal(vendorBudgetImpactFailureDelivery().charged, false);
  assert.equal(vendorBudgetImpactFailureDelivery().owedDelivery, false);
});

test("discovery example is a real engine delta with a frozen sold boundary", () => {
  const example = vendorBudgetImpactOutputExample();
  assertOutput(example);
  assert.equal(example.analysis, "actionable");
  assert.equal(example.boundary.soldFlag, false);
  assert.equal(example.boundary.purchaseAuthority, false);
  assert.equal(example.quote.amountAtomic, "5000");
});
