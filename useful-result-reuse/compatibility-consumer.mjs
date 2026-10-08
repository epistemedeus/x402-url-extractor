#!/usr/bin/env node
// Later process. It receives a public compatibility derivative and its own
// receipt capture. It does not receive a payment credential, a read grant,
// or the producer directory.

import { readFile } from "node:fs/promises";

import { clientFromCapture, containsAccount } from "./base-receipt.mjs";
import { CLOSED_SPONSORED_REF } from "./constants.mjs";
import { createCustomerRetention } from "./customer-grant.mjs";

if (process.env.COMMERCE_DATA_DIR || process.env.COMMERCE_INTERNAL_TOKEN || process.env.USEFUL_RESULT_GRANT) {
  process.stderr.write("producer_state_present\n");
  process.exit(2);
}

// Evaluation instant only. Unset uses the wall clock, so an expired grant
// stays rejected. A supplied clock does not grant payment permission.
function evaluationNow() {
  if (!Object.hasOwn(process.env, "USEFUL_RESULT_NOW")) return Date.now();
  const parsed = Date.parse(process.env.USEFUL_RESULT_NOW);
  if (!Number.isFinite(parsed)) {
    process.stderr.write("clock_rejected\n");
    process.exit(2);
  }
  return parsed;
}

const evaluatedAt = evaluationNow();

const derivativePath = process.env.USEFUL_RESULT_DERIVATIVE || "";
const receiptPath = process.env.USEFUL_RESULT_RECEIPT || "";
const directPath = process.env.USEFUL_RESULT_DIRECT_RECEIPT || receiptPath;
if (!derivativePath || !receiptPath) {
  process.stderr.write("derivative_required\n");
  process.exit(2);
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function dec(value) {
  if (typeof value === "bigint") return value.toString(10);
  const text = String(value ?? "");
  if (text.startsWith("0x") || text.startsWith("0X")) return BigInt(text).toString(10);
  return text;
}

function normalizeStatus(status) {
  const text = String(status || "");
  if (text === "0x1" || text === "success") return "success";
  if (text === "0x0" || text === "reverted") return "reverted";
  return text || "unknown";
}

function clientFromSuppliedCapture(capture) {
  if (!capture || capture.schema !== "samedaydesk.public-historical-base-receipt.v1") {
    const error = new Error("receipt_rejected");
    error.code = "receipt_rejected";
    throw error;
  }
  const hash = lower(capture.transactionHash);
  if (!hash || hash === CLOSED_SPONSORED_REF) return clientFromCapture(capture);
  if (lower(capture.blockHash) !== lower(capture.receipt?.blockHash)) {
    const error = new Error("receipt_rejected");
    error.code = "receipt_rejected";
    throw error;
  }
  const receipt = capture.receipt;
  const executed = {
    blockHash: lower(receipt.blockHash),
    blockNumber: BigInt(dec(receipt.blockNumber)),
    effectiveGasPrice: BigInt(dec(receipt.effectiveGasPrice)),
    from: lower(receipt.from),
    gasUsed: BigInt(dec(receipt.gasUsed)),
    logs: (receipt.logs || []).map((log) => ({
      address: lower(log.address),
      data: lower(log.data),
      logIndex: Number(dec(log.logIndex)),
      topics: (log.topics || []).map((topic) => lower(topic)),
    })),
    status: normalizeStatus(receipt.status),
    to: lower(receipt.to),
    transactionIndex: Number(dec(receipt.transactionIndex)),
    type: "eip1559",
  };
  const calls = { receipt: 0, block: 0 };
  return {
    calls,
    async getTransactionReceipt(args) {
      calls.receipt += 1;
      if (lower(args?.hash) !== hash) {
        const error = new Error("could not be found");
        error.name = "TransactionReceiptNotFoundError";
        throw error;
      }
      return executed;
    },
    async getBlock() {
      calls.block += 1;
      return { timestamp: BigInt(capture.blockTimestamp) };
    },
  };
}

const derivative = JSON.parse(await readFile(derivativePath, "utf8"));
const laterCapture = JSON.parse(await readFile(receiptPath, "utf8"));
const directCapture = directPath === receiptPath ? laterCapture : JSON.parse(await readFile(directPath, "utf8"));
const laterClient = clientFromSuppliedCapture(laterCapture);
const directClient = clientFromSuppliedCapture(directCapture);

let publicShares = null;
let corrections = null;
let revocations = null;
if (process.env.USEFUL_RESULT_BASE) {
  const currentUrl = new URL("/.well-known/useful-result-reuse/current.json", process.env.USEFUL_RESULT_BASE);
  const response = await fetch(currentUrl);
  if (response.status !== 200) {
    process.stderr.write("current_unavailable\n");
    process.exit(1);
  }
  const current = await response.json();
  publicShares = current.compatibility || [];
  corrections = current.compatibilityCorrections || [];
  revocations = current.compatibilityRevocations || [];
}

const kinds = [];
const memory = () => ({
  maxRecordBytes: 16384,
  async read() { return []; },
  async append() {},
  async mutate(_name, work) { return (await work([]))?.result; },
});
const retention = createCustomerRetention({
  customerStore: memory(),
  now: () => evaluatedAt,
  remember: async (kind) => { kinds.push(kind); },
  sharedStore: memory(),
});
const result = await retention.consumeDeliveredKnowledge({
  client: laterClient,
  corrections,
  derivative,
  directClient,
  publicShares,
  revocations,
});
const payload = {
  continuedExecution: result.continuedExecution === true,
  directBlock: result.direct?.blockNumber ?? null,
  directDecision: result.direct?.decision ?? null,
  directFee: result.direct?.transactionFeeWei ?? null,
  directReceiptCalls: directClient.calls?.receipt ?? 0,
  executionSaved: result.executionSaved,
  historicalRevenue: result.historicalRevenue,
  knowledgeApplied: result.knowledgeApplied === true,
  laterBlock: result.later?.blockNumber ?? null,
  laterDecision: result.later?.decision ?? null,
  laterFee: result.later?.transactionFeeWei ?? null,
  laterReceiptCalls: laterClient.calls?.receipt ?? 0,
  metricKinds: kinds,
  observedSaving: result.observedSaving,
  ownerQa: true,
  paymentPermitted: result.paymentPermitted,
  reason: result.reason,
  recognizedRevenueAtomic: result.recognizedRevenueAtomic,
  revenueRecognized: result.revenueRecognized,
  sameUsefulOutput: result.sameUsefulOutput === true,
  usefulTransferred: result.usefulTransferred,
};
if (containsAccount(payload) || containsAccount(result.later) || containsAccount(result.direct)) {
  process.stdout.write(`${JSON.stringify({ ownerQa: true, paymentPermitted: false, reason: "account_leak" })}\n`);
  process.exit(2);
}
process.stdout.write(`${JSON.stringify(payload)}\n`);
