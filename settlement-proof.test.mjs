import assert from "node:assert/strict";
import test from "node:test";

import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";

import {
  BASE_USDC,
  normalizeSettlementProofInput,
  settlementProof,
} from "./settlement-proof.mjs";

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TX = `0x${"1".repeat(64)}`;
const PAYER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";

function transfer(from = PAYER, to = RECIPIENT, value = 5_000n) {
  return {
    address: BASE_USDC,
    topics: encodeEventTopics({ abi: [TRANSFER_EVENT], eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

function client({ logs = [transfer()], status = "success", receiptError = false, blockError = false } = {}) {
  return {
    async getTransactionReceipt() {
      if (receiptError) throw new Error("missing");
      return { status, blockNumber: 49_823_378n, logs };
    },
    async getBlock() {
      if (blockError) throw new Error("missing");
      return { timestamp: 1_786_350_903n };
    },
  };
}

const input = { transactionHash: TX, recipient: RECIPIENT, amountAtomic: "5000", payer: PAYER };

test("normalizes the exact bounded Base-USDC proof request", () => {
  assert.deepEqual(normalizeSettlementProofInput(input), {
    transactionHash: TX,
    recipient: RECIPIENT,
    amountAtomic: "5000",
    payer: PAYER,
  });
  assert.throws(() => normalizeSettlementProofInput({ ...input, transactionHash: "0x12" }), /32-byte/);
  assert.throws(() => normalizeSettlementProofInput({ ...input, recipient: "bad" }), /recipient/);
  assert.throws(() => normalizeSettlementProofInput({ ...input, amountAtomic: "0" }), /amountAtomic/);
  assert.throws(() => normalizeSettlementProofInput({ ...input, payer: "bad" }), /payer/);
});

test("verifies one exact successful canonical Base USDC transfer", async () => {
  const result = await settlementProof(input, {
    client: client(),
    now: () => new Date("2026-08-11T08:30:00.000Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "verified");
  assert.equal(result.settlement.verified, true);
  assert.equal(result.settlement.observed.amountAtomic, "5000");
  assert.equal(result.settlement.observed.amountUsdc, "0.005");
  assert.deepEqual(result.findings, []);
  assert.equal(result.boundary.privateLedgerRead, false);
});

test("fails closed on recipient, amount, payer, duplicate, status, and block mismatches", async () => {
  const recipient = await settlementProof(input, { client: client({ logs: [transfer(PAYER, OTHER)] }) });
  assert.equal(recipient.decision, "not_verified");
  assert.equal(recipient.findings[0].code, "recipient_not_paid");

  const amount = await settlementProof(input, { client: client({ logs: [transfer(PAYER, RECIPIENT, 4_999n)] }) });
  assert.equal(amount.findings[0].code, "amount_mismatch");

  const payer = await settlementProof(input, { client: client({ logs: [transfer(OTHER)] }) });
  assert.equal(payer.findings[0].code, "payer_mismatch");

  const duplicate = await settlementProof(input, { client: client({ logs: [transfer(), transfer()] }) });
  assert.equal(duplicate.findings[0].code, "ambiguous_exact_transfer");

  const status = await settlementProof(input, { client: client({ status: "reverted" }) });
  assert.equal(status.findings[0].code, "transaction_unsuccessful");

  const block = await settlementProof(input, { client: client({ blockError: true }) });
  assert.equal(block.decision, "not_verified");
  assert.equal(block.findings[0].code, "block_unavailable");
});

test("returns a bounded diagnostic when the public receipt is unavailable", async () => {
  const result = await settlementProof(input, { client: client({ receiptError: true }) });
  assert.equal(result.ok, false);
  assert.equal(result.decision, "receipt_unavailable");
  assert.equal(result.settlement.verified, false);
  assert.equal(result.findings[0].code, "receipt_unavailable");
});
