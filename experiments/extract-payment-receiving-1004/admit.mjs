import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELLER_TX = "0x1d9f6315c0c0c2c9c5976dc8fa567ca0bb226e360cd3d3c64814f4d8da176b37";
const SELLER_PAYER = "761193f9b887";
const AUGUST_PAYER = "41a1a825bcef";
const OPENED_AFTER = Date.parse("2026-10-04T13:00:47.352Z");
const ADMITTED_END = Date.parse("2026-10-04T17:16:31.688Z");

export async function admitEvidence(evidence, laterDemand, laterBytes) {
  const failures = [];
  const fail = (code) => failures.push(code);
  if (!evidence || typeof evidence !== "object") fail("evidence_missing");
  if (evidence?.recognizedRevenue !== false) fail("recognized_revenue_promoted");
  if (evidence?.recognizedRevenueAtomic !== "0") fail("recognized_revenue_amount_promoted");
  if (evidence?.completeCensus !== false) fail("census_promoted");
  if (evidence?.independentCustomer !== false) fail("independent_customer_promoted");
  if (evidence?.rollingWindowsAreDeltas !== false) fail("window_delta_promoted");
  const extracts = evidence?.chainJoin?.extract;
  if (!Array.isArray(extracts) || extracts.length !== 2) fail("extract_pair_missing");
  const [first, second] = extracts || [];
  if (first?.chainFromSha256_12 !== second?.chainFromSha256_12) fail("extract_payers_differ");
  if (first?.chainFromSha256_12 === SELLER_PAYER || second?.chainFromSha256_12 === SELLER_PAYER) {
    fail("extract_payer_collapsed_into_seller");
  }
  if (first?.chainFromSha256_12 === AUGUST_PAYER || second?.chainFromSha256_12 === AUGUST_PAYER) {
    fail("extract_payer_collapsed_into_august_cohort");
  }
  for (const row of extracts || []) {
    if (row.amountAtomic !== "5000") fail("extract_amount");
    if (row.replay !== false) fail("extract_replay_promoted");
    if (row.settlementReference === SELLER_TX) fail("extract_duplicates_seller_settlement");
    const at = Date.parse(row.timestamp);
    if (!Number.isFinite(at) || at <= OPENED_AFTER || at > ADMITTED_END) fail("extract_timestamp_outside_new_interval");
  }
  if (first?.settlementReference === second?.settlementReference) fail("extract_settlements_not_distinct");
  if (evidence?.chainJoin?.knownSeller?.chainFromSha256_12 === first?.chainFromSha256_12) {
    fail("seller_payer_not_distinct");
  }
  if (evidence?.chainJoin?.ledgerDeltaAmountAtomic !== "10000") fail("ledger_delta_amount");
  if (evidence?.chainJoin?.ledgerDeltaSettlements !== 2) fail("ledger_delta_count");
  if (evidence?.delivery?.body !== "not_read") fail("delivery_body_backfilled");
  if (evidence?.delivery?.usefulness !== "unknown") fail("usefulness_backfilled");
  for (const attempt of evidence?.attempts || []) {
    if (attempt.commerceEventId !== null) fail("event_id_invented");
    if (attempt.bankedRecognizedRevenue !== false) fail("attempt_revenue_promoted");
    if (attempt.paymentClass !== "unclassified") fail("payment_class_promoted");
    if (attempt.duplicateOfPriorLedgerEntry !== false) fail("duplicate_claim");
  }
  if (evidence?.repeatSemantics?.repeatPaidSuccessActors !== 1) fail("repeat_count");
  if (evidence?.repeatSemantics?.sellerPlanePaidSuccess !== 1) fail("seller_plane_count");
  if (evidence?.repeatSemantics?.paidSuccessActors !== 2) fail("paid_actor_count");
  if (evidence?.attribution?.absentInternalMarkerProvesOutsideBuyer !== false) fail("missing_marker_called_outside");
  if (laterDemand) {
    const digest = createHash("sha256").update(laterBytes).digest("hex");
    if (evidence?.laterRead?.sha256 !== digest) fail("later_read_digest");
    if (laterDemand.paidSuccessByRoute?.["/extract"] !== 2) fail("later_extract_count");
    if (laterDemand.paidSuccessByRoute?.["/commerce/seller-integrity-audit"] !== 1) fail("later_seller_count");
    if (laterDemand.repeatPaidSuccessActors !== 1) fail("later_repeat");
    if (laterDemand.paidSuccessActors !== 2) fail("later_actors");
    if (laterDemand.independentPaidSuccessActors !== 0) fail("later_independent");
    if (laterDemand.distinctSettlementReferences !== 3) fail("later_distinct_settlements");
    if (laterDemand.replaySuccessEvents !== 0) fail("later_replay");
    if (laterDemand.paidSuccessByClass?.unclassified !== 3) fail("later_class");
    const plane = laterDemand.paidDiagnosticReportContract?.transactionPlane;
    if (plane?.paidSuccess !== 1) fail("later_seller_plane");
    if (laterDemand.durableRareFunnel?.paidSuccessEvents !== 3) fail("later_rare");
    if (laterDemand.durableRareFunnel?.coverage?.requestedWindowComplete !== false) fail("later_rare_census");
    if (laterDemand.requestedWindowComplete !== false) fail("later_stream_census");
    if (laterDemand.trafficProvenance?.populations?.unattributedExternal?.paidSuccesses !== 3) {
      fail("later_origin");
    }
    if (laterDemand.trafficProvenance?.populations?.verifiedInternal?.paidSuccesses !== 0) {
      fail("later_internal_paid");
    }
  }
  return { accepted: failures.length === 0, failures };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node admit.mjs <evidence.json>");
    process.exit(2);
  }
  const evidence = JSON.parse(await readFile(file, "utf8"));
  const laterPath = path.join(HERE, "later-public-demand.json");
  const laterBytes = await readFile(laterPath);
  const laterDemand = JSON.parse(laterBytes.toString("utf8"));
  const result = await admitEvidence(evidence, laterDemand, laterBytes);
  console.log(JSON.stringify(result));
  process.exit(result.accepted ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
