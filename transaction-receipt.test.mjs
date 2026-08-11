import assert from "node:assert/strict";
import test from "node:test";

import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";

import {
  NETWORKS,
  normalizeTransactionReceiptInput,
  transactionReceipt,
} from "./transaction-receipt.mjs";

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TX = `0x${"1".repeat(64)}`;
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";

function transfer(token, value) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: [TRANSFER_EVENT], eventName: "Transfer", args: { from: FROM, to: TO } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex: 7,
  };
}

function client({ receiptError, errorName = "Error", blockError = false } = {}) {
  return {
    async getTransactionReceipt() {
      if (receiptError) {
        const error = new Error(receiptError);
        error.name = errorName;
        throw error;
      }
      return {
        status: "success",
        blockNumber: 50n,
        blockHash: `0x${"2".repeat(64)}`,
        transactionIndex: 3,
        from: FROM,
        to: TO,
        contractAddress: null,
        type: "eip1559",
        gasUsed: 21_000n,
        effectiveGasPrice: 2_000_000_000n,
        logs: [transfer(NETWORKS.base.canonicalUsdc, 5_000n), transfer(TOKEN, 9n), { address: TOKEN, topics: [], data: "0x" }],
      };
    },
    async getBlock() {
      if (blockError) throw new Error("missing");
      return { timestamp: 1_786_350_903n };
    },
  };
}

test("normalizes a bounded Base or Ethereum receipt request", () => {
  assert.deepEqual(normalizeTransactionReceiptInput({ transactionHash: TX }), { transactionHash: TX, network: "base" });
  assert.deepEqual(normalizeTransactionReceiptInput({ hash: TX.toUpperCase().replace("0X", "0x"), network: "ethereum" }), { transactionHash: TX, network: "ethereum" });
  assert.throws(() => normalizeTransactionReceiptInput({ transactionHash: "0x12" }), /32-byte/);
  assert.throws(() => normalizeTransactionReceiptInput({ transactionHash: TX, network: "arbitrum" }), /base or ethereum/);
});

test("returns normalized fee, block, and decoded transfer evidence", async () => {
  const result = await transactionReceipt({ transactionHash: TX }, {
    client: client(),
    now: () => new Date("2026-08-11T08:30:00.000Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "found");
  assert.equal(result.chain.network, "eip155:8453");
  assert.equal(result.transaction.status, "success");
  assert.equal(result.transaction.blockTimestamp, "2026-08-10T08:35:03.000Z");
  assert.equal(result.transaction.transactionFeeWei, "42000000000000");
  assert.equal(result.receipt.logCount, 3);
  assert.equal(result.receipt.decodedTransferCount, 2);
  assert.equal(result.receipt.canonicalUsdcTransferCount, 1);
  assert.equal(result.canonicalUsdcTransfers[0].amountUsdc, "0.005");
  assert.equal(result.boundary.walletAccessed, false);
  assert.equal(result.boundary.rawLogsReturned, false);
});

test("preserves a useful receipt when the block timestamp is unavailable", async () => {
  const result = await transactionReceipt({ transactionHash: TX, network: "ethereum" }, { client: client({ blockError: true }) });
  assert.equal(result.ok, true);
  assert.equal(result.transaction.blockTimestamp, null);
  assert.equal(result.findings[0].code, "block_timestamp_unavailable");
});

test("distinguishes a missing receipt from RPC unavailability", async () => {
  const missing = await transactionReceipt({ transactionHash: TX }, { client: client({ receiptError: "not found", errorName: "TransactionReceiptNotFoundError" }) });
  assert.equal(missing.ok, true);
  assert.equal(missing.decision, "not_found");
  assert.equal(missing.findings[0].code, "receipt_not_found");

  const unavailable = await transactionReceipt({ transactionHash: TX }, { client: client({ receiptError: "network down" }) });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.decision, "rpc_unavailable");
  assert.equal(unavailable.findings[0].code, "rpc_unavailable");
});
