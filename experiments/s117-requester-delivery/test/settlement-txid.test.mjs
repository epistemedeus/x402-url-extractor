import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  aibtcMainLookup,
  aibtcPr667Lookup,
  encodePaymentResponseHeader,
  meritX402scanV1OnlyLookup,
  recoverSettlementTxid,
} from "../src/settlement-txid.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STACKS_TXID = "5d6598358e76fd30d3946c6a6b776f400dddfcfcd884b6aed5cfafeabe74cfb6";
const EVM_TXID = `0x${"ab".repeat(32)}`;

function v2Settlement(txid = STACKS_TXID) {
  return { success: true, payer: "SPTEST_REDACTED", transaction: txid, network: "stacks:1" };
}

test("aibtc main lookup misses V2 payment-response and payment.txid", () => {
  const response = {
    headers: { "payment-response": encodePaymentResponseHeader(v2Settlement()) },
    body: { payment: { txid: STACKS_TXID, amount: "100", asset: "sBTC" } },
  };
  assert.equal(aibtcMainLookup(response), null);
  const recovered = recoverSettlementTxid(response, { evidenceClass: "provided_report" });
  assert.equal(recovered.decision, "settled");
  assert.equal(recovered.txid, STACKS_TXID);
  assert.equal(recovered.lookups.aibtc_main, null);
  assert.equal(recovered.lookups.aibtc_pr667, STACKS_TXID);
  assert.equal(recovered.lookups.merit_x402scan_v1_only, null);
  assert.equal(recovered.notes.aibtc_main_misses_v2_header, true);
  assert.equal(recovered.notes.merit_v1_only_misses_v2_header, true);
});

test("provided-report fixture matches the public aibtc #666 locations", async () => {
  const fixture = JSON.parse(
    await readFile(join(ROOT, "fixtures/settlement/aibtc666-provided-report.json"), "utf8"),
  );
  assert.equal(fixture.evidenceClass, "provided_report");
  const recovered = recoverSettlementTxid(fixture.response, { evidenceClass: fixture.evidenceClass });
  assert.equal(recovered.txid, STACKS_TXID);
  assert.equal(recovered.evidenceClass, "provided_report");
  assert.equal(recovered.lookups.aibtc_main, null);
  assert.equal(recovered.lookups.aibtc_pr667, STACKS_TXID);
});

test("Merit v1-only lookup reads X-PAYMENT-RESPONSE and misses PAYMENT-RESPONSE", () => {
  const v1Only = {
    headers: { "x-payment-response": encodePaymentResponseHeader({ success: true, transaction: EVM_TXID, network: "eip155:8453" }) },
    body: {},
  };
  assert.equal(meritX402scanV1OnlyLookup(v1Only), EVM_TXID);
  assert.equal(aibtcMainLookup(v1Only), null);
  assert.equal(aibtcPr667Lookup(v1Only), null);
  const recovered = recoverSettlementTxid(v1Only, { evidenceClass: "provided_report" });
  assert.equal(recovered.txid, EVM_TXID);
  assert.equal(recovered.notes.aibtc_pr667_misses_v1_header, true);

  const v2Only = {
    headers: { "payment-response": encodePaymentResponseHeader({ success: true, transaction: EVM_TXID, network: "eip155:8453" }) },
    body: {},
  };
  assert.equal(meritX402scanV1OnlyLookup(v2Only), null);
  assert.equal(recoverSettlementTxid(v2Only, { evidenceClass: "provided_report" }).txid, EVM_TXID);
});

test("PR667 prefers body.txid and can hide a conflicting header; portable reports conflict", () => {
  const response = {
    headers: { "payment-response": encodePaymentResponseHeader(v2Settlement(STACKS_TXID)) },
    body: { txid: EVM_TXID },
  };
  assert.equal(aibtcPr667Lookup(response), EVM_TXID);
  const recovered = recoverSettlementTxid(response, { evidenceClass: "provided_report" });
  assert.equal(recovered.decision, "conflict");
  assert.equal(recovered.txid, null);
  assert.deepEqual(recovered.conflictingTxids.sort(), [EVM_TXID, STACKS_TXID].sort());
});

test("unobservable payment stays null with an explicit decision", () => {
  const recovered = recoverSettlementTxid(
    { status: 200, headers: {}, body: { ok: true } },
    { evidenceClass: "independently_observed" },
  );
  assert.equal(recovered.decision, "unobservable");
  assert.equal(recovered.txid, null);
});

test("success:false with empty transaction is settlement_failed, not settled", () => {
  const recovered = recoverSettlementTxid({
    headers: {
      "payment-response": encodePaymentResponseHeader({
        success: false,
        errorReason: "insufficient_funds",
        transaction: "",
        network: "eip155:8453",
      }),
    },
    body: {},
  }, { evidenceClass: "provided_report" });
  assert.equal(recovered.decision, "settlement_failed");
  assert.equal(recovered.txid, null);
});

test("pending marker and empty strings are not chain txids", () => {
  const recovered = recoverSettlementTxid({
    headers: { "x-transaction-id": "pending:dedup-key" },
    body: { txid: "", payment_txid: "  " },
  }, { evidenceClass: "provided_report" });
  assert.equal(recovered.txid, null);
  assert.equal(aibtcMainLookup({ headers: { "x-transaction-id": "pending:dedup-key" }, body: {} }), null);
});

test("MCP _meta x402/payment-response is a distinct locator", () => {
  const recovered = recoverSettlementTxid({
    result: {
      _meta: {
        "x402/payment-response": {
          success: true,
          transaction: EVM_TXID,
          network: "eip155:84532",
          payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
        },
      },
    },
  }, { evidenceClass: "provided_report" });
  assert.equal(recovered.txid, EVM_TXID);
  assert.equal(recovered.candidates[0].locator, "x402/payment-response");
  assert.equal(aibtcPr667Lookup({ result: recovered }), null);
});

test("portable recovers base64 and base64url payment-response encodings", () => {
  const padded = { success: true, transaction: EVM_TXID, network: "eip155:8453", n: "1" };
  const base64 = encodePaymentResponseHeader(padded, { encoding: "base64" });
  const base64url = encodePaymentResponseHeader(padded, { encoding: "base64url" });
  for (const header of [base64, base64url]) {
    assert.equal(
      recoverSettlementTxid({ headers: { "payment-response": header }, body: {} }, { evidenceClass: "provided_report" }).txid,
      EVM_TXID,
    );
  }
});

test("malformed header is ignored and body.payment.txid still recovers", () => {
  const recovered = recoverSettlementTxid({
    headers: { "payment-response": "not-base64!" },
    body: { payment: { txid: STACKS_TXID } },
  }, { evidenceClass: "provided_report" });
  assert.equal(recovered.txid, STACKS_TXID);
  assert.equal(recovered.candidates.find((entry) => entry.locator === "payment-response").parseError, "malformed_base64_json");
});

test("oversized header is rejected", () => {
  const recovered = recoverSettlementTxid({
    headers: { "payment-response": "A".repeat(131_073) },
    body: {},
  }, { evidenceClass: "provided_report" });
  assert.equal(recovered.txid, null);
  assert.equal(recovered.candidates[0].parseError, "oversized");
});

test("refuses an unknown evidence class", () => {
  assert.throws(() => recoverSettlementTxid({}, { evidenceClass: "buyer_proof" }), /evidenceClass/);
});
