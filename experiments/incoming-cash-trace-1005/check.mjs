#!/usr/bin/env node
// Rejects a join that backfills the October 4 extract delivery, counts the
// treasury payout as this settlement, or books the 0.020 as recognized revenue.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SCHEMA = "samedaydesk.incoming-cash-trace-1005.evidence.v1";
const INCOMING = "0x2439870db33f6e81157beffed44c26b02aad663aff595424929ac04f9030008d";
const PAYOUT = "0x6c51682c8678b4779548e8b717b327ab1b9dfb06141850cce92eb220075e3a20";
const EXTRACTS = [
  "0x3e3dee90f56fb88f9f1ec334dd4b78b119ab2a408c8181c273e8e22685d12090",
  "0x104467b62ad4edff622eb0f008e9d127b59c75075947ce3962dbf7c4d622887f",
];

export function violations(evidence) {
  const found = [];
  const bad = (code) => found.push(code);
  if (!evidence || typeof evidence !== "object") return ["evidence_not_object"];
  if (evidence.schema !== SCHEMA) bad("schema");
  const join = evidence.join || {};
  const chain = evidence.chain || {};
  const ledger = evidence.ledgerDelta || {};
  const window = evidence.demandWindow || {};
  const delivery = evidence.delivery || {};
  const caller = evidence.caller || {};
  const revenue = evidence.revenue || {};
  const inflows = chain.treasuryInflows || [];

  if (join.settlementReference !== INCOMING) bad("settlement_reference");
  if (join.route !== "/defi/morpho-position") bad("route");
  if (join.newSettlementCount !== 1) bad("new_settlement_count");
  if (join.amountAtomic !== "20000") bad("amount");
  if (join.countsPayoutAsSettlement === true) bad("payout_counted");
  if (join.payoutReference === INCOMING) bad("payout_identity");
  if (chain.payoutReference !== PAYOUT) bad("payout_reference");
  if (chain.payoutAmountAtomic !== "100000") bad("payout_amount");
  if (chain.payoutDirection !== "outgoing_plain_transfer") bad("payout_direction");
  if (!inflows.map((row) => row.tx).includes(INCOMING)) bad("incoming_missing");
  if (inflows.some((row) => row.tx === PAYOUT)) bad("payout_listed_as_inflow");
  if (inflows.filter((row) => row.atomic === "20000").length !== 1) bad("twenty_thousand_inflow_count");
  if (inflows.filter((row) => EXTRACTS.includes(row.tx)).length !== 2) bad("prior_extract_inflows");
  if (ledger.route !== "/defi/morpho-position") bad("ledger_route");
  if (ledger.settlementDelta !== 1 || ledger.amountAtomicDelta !== "20000") bad("ledger_delta");
  if (ledger.extractSettlementDelta !== 0) bad("extract_ledger_moved");
  if (ledger.paymentClass !== "unclassified") bad("payment_class");
  if (window.paidSuccessByRoute?.["/defi/morpho-position"] !== 1) bad("window_morpho_paid");
  if (window.paidSuccessByRoute?.["/extract"] !== 2) bad("window_extract_paid");
  if (window.independentPaidSuccessActors !== 0) bad("independence");
  if (delivery.class !== "not_emitted_unsupported_target") bad("delivery_class");
  if (delivery.copiedFromExtractPair === true) bad("extract_delivery_backfill");
  if (delivery.usefulness !== "unknown") bad("usefulness");
  if (delivery.buyerPredicate !== "unknown") bad("buyer_predicate");
  if (caller.origin !== "unattributed_external") bad("origin");
  if (caller.verifiedInternal !== false || caller.selfReportedOwnerMonitor !== false) bad("owner_marker");
  if (caller.ownerMarkerAbsenceProvesOutsideBuyer === true) bad("owner_absence_promoted");
  if (caller.sameOnchainPayerAsExtractPair !== false) bad("extract_payer_continuity");
  if (caller.repeatPayerWithinWindow !== false) bad("repeat_payer");
  if (revenue.recognizedUsdc !== "10.955") bad("recognized_revenue");
  if (revenue.promotedToOrganicSale === true) bad("organic_promotion");
  if (revenue.walletBalanceIsRevenue === true) bad("balance_is_revenue");
  return found;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node experiments/incoming-cash-trace-1005/check.mjs <evidence.json>");
    process.exit(2);
  }
  const evidence = JSON.parse(await readFile(path, "utf8"));
  const found = violations(evidence);
  if (found.length) {
    console.error(JSON.stringify({ ok: false, violations: found }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    settlementReference: evidence.join.settlementReference,
    route: evidence.join.route,
    newSettlementCount: evidence.join.newSettlementCount,
    recognizedUsdc: evidence.revenue.recognizedUsdc,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
