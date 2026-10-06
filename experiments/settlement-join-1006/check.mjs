#!/usr/bin/env node
// Rejects a 2026-10-06 settlement join that invents a transaction reference,
// recounts the already classified Morpho settlement, moves internal or
// validation owners, backfills delivery, or names a customer.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const SCHEMA = "samedaydesk.settlement-join-1006.evidence.v1";
export const PRIOR_REFERENCE = "0x2439870db33f6e81157beffed44c26b02aad663aff595424929ac04f9030008d";
const POLICY = "Explicit known-payer rules classify internal, marketplace validation, incentivized, affiliated, or independently confirmed buyers. Unknown or missing payer identities remain unclassified and never become independent by inference.";
const REFERENCE_RE = /0x[0-9a-fA-F]{64}/g;

const PINS = Object.freeze({
  currentDemandSha256: "018bf04ba87c9a87d7e84ff8e430ce0dc61a4755c6b1ea134a69db78b3695469",
  currentReceivingSha256: "026ba0a74d7fc726f183885abd740c0263023d093e229d0b1cfbcb4006aefa1d",
  priorDemandSha256: "932830c475c0ef2c7a00b1b39c14c3b28275f46eb124702b35c8b7eb69bbe619",
  priorReceivingSha256: "baa841d0349337e6e0937f802da94d1899d47292913cb70d3989a65b170c6de6",
  currentGeneratedAt: "2026-10-06T04:53:48.437Z",
  priorGeneratedAt: "2026-10-06T00:17:10.607Z",
});

function settlementByRoute(evidence, route) {
  return (evidence.settlements || []).find((row) => row && row.route === route) || null;
}

export function violations(evidence) {
  const found = [];
  const bad = (code) => {
    if (!found.includes(code)) found.push(code);
  };
  if (!evidence || typeof evidence !== "object") return ["evidence_not_object"];
  if (evidence.schema !== SCHEMA) bad("schema");
  if (evidence.decisionDate !== "2026-10-06") bad("decision_date");
  if (evidence.cash !== 0) bad("cash_spent");
  if (evidence.newTelemetryLedger === true) bad("new_telemetry_ledger");
  if (evidence.chainCensus === true) bad("chain_census");
  if (evidence.handlerChange === true) bad("handler_owner_replaced");
  if (evidence.repair?.needed === true) bad("repair_not_indicated");

  const sources = evidence.sources || {};
  if (sources.currentDemand?.sha256 !== PINS.currentDemandSha256) bad("current_demand_pin");
  if (sources.currentReceiving?.sha256 !== PINS.currentReceivingSha256) bad("current_receiving_pin");
  if (sources.priorDemand?.sha256 !== PINS.priorDemandSha256) bad("prior_demand_pin");
  if (sources.priorReceiving?.sha256 !== PINS.priorReceivingSha256) bad("prior_receiving_pin");
  if (sources.currentDemand?.generatedAt !== PINS.currentGeneratedAt) bad("current_generated_at");
  if (sources.priorDemand?.generatedAt !== PINS.priorGeneratedAt) bad("prior_generated_at");
  if (sources.currentReceiving?.status !== 200) bad("receiving_status");
  if (sources.currentReceiving?.cash !== 0) bad("receiving_cash");
  if (sources.currentReceiving?.classification !== "owner_monitor_readback") bad("receiving_classification");
  if (sources.currentReceiving?.bytes !== 45388) bad("receiving_bytes");
  if (sources.paymentClassPolicy !== POLICY) bad("classification_policy");

  const owners = evidence.owners || {};
  if (owners.canonicalSettlement !== "unchanged") bad("canonical_owner");
  if (owners.classification !== "unchanged") bad("classification_owner");
  if (owners.internalSettlements !== 12 || owners.internalAmountAtomic !== "577000") bad("internal_moved");
  if (owners.validationSettlements !== 1 || owners.validationAmountAtomic !== "10000") bad("validation_moved");

  const ledger = evidence.ledger || {};
  if (ledger.priorSettlements !== 47 || ledger.currentSettlements !== 49) bad("settlement_count");
  if (ledger.priorAmountAtomic !== "1067000" || ledger.currentAmountAtomic !== "1092000") bad("amount");
  if (ledger.settlementDelta !== 2 || ledger.amountAtomicDelta !== "25000") bad("delta");
  if (ledger.unclassifiedSettlementDelta !== 2 || ledger.unclassifiedAmountAtomicDelta !== "25000") bad("unclassified_delta");
  if (ledger.issueCount !== 0 || ledger.invalidLines !== 0) bad("ledger_issues");
  if (ledger.windowDistinctSettlementReferences === 49) bad("window_count_used_as_canonical");
  if (ledger.canonicalCountSource !== "settlementReconciliation.ledger.reconciledSettlements") bad("canonical_count_source");

  const excluded = evidence.excludedPriorSettlement || {};
  if (excluded.settlementReference !== PRIOR_REFERENCE) bad("excluded_prior_reference");
  if (excluded.countedAsNew !== false) bad("prior_settlement_recounted");
  if (excluded.route !== "/defi/morpho-position" || excluded.amountAtomic !== "20000") bad("excluded_prior_route");

  const rows = evidence.settlements;
  if (!Array.isArray(rows) || rows.length !== 2) bad("settlement_cardinality");
  const extract = settlementByRoute(evidence, "/extract");
  const morpho = settlementByRoute(evidence, "/defi/morpho-position");
  if (!extract) bad("route_extract");
  if (!morpho) bad("route_morpho");
  checkRow(extract, {
    amountAtomic: "5000",
    displayUsdc: "0.005",
    priorWindowCount: 0,
    currentWindowCount: 1,
  }, bad);
  checkRow(morpho, {
    amountAtomic: "20000",
    displayUsdc: "0.020",
    priorWindowCount: 1,
    currentWindowCount: 2,
  }, bad);
  if (morpho && morpho.retainedAlreadyClassifiedInsideBothWindows !== true) bad("morpho_retained_row");
  if (extract && extract.amountAtomic === "20000") bad("amount_route_swap");
  if (morpho && morpho.amountAtomic === "5000") bad("amount_route_swap");

  const serialized = JSON.stringify(evidence);
  const hashes = serialized.match(REFERENCE_RE) || [];
  for (const hash of hashes) {
    if (hash.toLowerCase() !== PRIOR_REFERENCE) bad("invented_settlement_reference");
  }
  if (rows?.some((row) => row && row.settlementReference)) bad("invented_settlement_reference");
  if (serialized.includes(PRIOR_REFERENCE) && excluded.settlementReference !== PRIOR_REFERENCE) {
    bad("prior_reference_context");
  }
  return found;
}

function checkRow(row, expected, bad) {
  if (!row) return;
  if (row.settlementReference !== null) bad("invented_settlement_reference");
  if (row.paymentClass !== "unclassified" || row.classificationDecision !== "remain_unclassified") bad("payment_class");
  if (row.amountAtomic !== expected.amountAtomic || row.displayUsdc !== expected.displayUsdc) bad("row_amount");
  if (row.protocol !== "x402") bad("protocol");
  if (row.ordinaryRequestJoined !== true) bad("ordinary_request");
  if (row.priorWindowCount !== expected.priorWindowCount || row.currentWindowCount !== expected.currentWindowCount) {
    bad("window_count");
  }
  if (row.eventId !== null) bad("event_id_invented");
  if (row.exactTimestamp !== null) bad("timestamp_invented");
  if (row.methodObserved !== null) bad("method_invented");
  if (row.customerIdentity !== null) bad("customer_identity");
  if (row.ownerMarkerAbsenceProvesOutsideBuyer === true) bad("owner_absence_promoted");
  if (row.independentBuyer === true) bad("independent_promoted");
  if (row.actorBoundToSettlement === true) bad("actor_bound");
  if (row.discoverySource !== "direct-or-unattributed") bad("discovery_source");
  if (row.originPopulation !== "unattributed_external") bad("origin_population");
  if (row.deliveryRecordPresent !== false) bad("delivery_backfill");
  if (row.copiedFromPriorDelivery === true) bad("delivery_backfill");
  if (row.sufficiency !== "unknown") bad("sufficiency_claimed");
  if (row.acceptance !== "unknown") bad("acceptance_claimed");
  if (row.usefulness !== "unknown") bad("usefulness_claimed");
  if (!row.referenceBoundary || typeof row.referenceBoundary !== "string") bad("reference_boundary");
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node experiments/settlement-join-1006/check.mjs <evidence.json>");
    process.exit(2);
  }
  const evidence = JSON.parse(await readFile(path, "utf8"));
  const found = violations(evidence);
  if (found.length) {
    console.error(JSON.stringify({ ok: false, violations: found }));
    process.exit(1);
  }
  const rows = evidence.settlements.map((row) => ({
    route: row.route,
    amountAtomic: row.amountAtomic,
    settlementReference: row.settlementReference,
    paymentClass: row.paymentClass,
    sufficiency: row.sufficiency,
    acceptance: row.acceptance,
  }));
  console.log(JSON.stringify({ ok: true, decisionDate: evidence.decisionDate, settlements: rows }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
