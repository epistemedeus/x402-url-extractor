import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiItem,
} from "viem";

import {
  BASE_USDC,
  reconcileCommerceSettlementEvents,
  summarizeCommerceSettlementLedger,
} from "./commerce-settlement-reconciler.mjs";

const SECRET = "settlement-reconciliation-test-secret";
const PAYER = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const REFERENCE = `0x${"a".repeat(64)}`;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

function actorFor(address) {
  return createHmac("sha256", SECRET)
    .update(`payer:${address.toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

function event(overrides = {}) {
  return {
    v: 1,
    id: "event-1",
    ts: "2026-08-09T14:00:00.000Z",
    route: "/extract",
    result: "paid_success",
    paymentProtocol: "x402",
    paymentActor: actorFor(PAYER),
    settlementReference: REFERENCE,
    settlementAmountAtomic: "50000",
    settlementNetwork: "eip155:8453",
    settlementCurrency: BASE_USDC,
    ...overrides,
  };
}

function receipt({ amount = 50000n, from = PAYER, status = "success", to = TREASURY } = {}) {
  return {
    status,
    blockNumber: 123n,
    logs: [{
      address: getAddress(BASE_USDC),
      topics: encodeEventTopics({
        abi: [TRANSFER],
        eventName: "Transfer",
        args: { from: getAddress(from), to: getAddress(to) },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    }],
  };
}

function clientFor(value) {
  return {
    async getTransactionReceipt() { return value; },
    async getBlock() { return { timestamp: 1_754_742_000n }; },
  };
}

async function reconcile(events, value = receipt()) {
  return reconcileCommerceSettlementEvents(
    events.map((item) => JSON.stringify(item)).join("\n"),
    "",
    {
      actorSecret: SECRET,
      client: clientFor(value),
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      treasury: TREASURY,
      now: () => new Date("2026-08-09T15:00:00.000Z"),
    },
  );
}

test("reconciles one canonical Base USDC transfer with payer continuity", async () => {
  const result = await reconcile([event()]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.eligibleSettlementReferences, 1);
  assert.equal(result.newRecords.length, 1);
  assert.equal(result.newRecords[0].amountAtomic, "50000");
  assert.equal(result.newRecords[0].paymentClass, "validation");
  assert.equal(result.newRecords[0].payerContinuity, "matched_request_pseudonym");

  const summary = summarizeCommerceSettlementLedger(JSON.stringify(result.newRecords[0]));
  assert.equal(summary.reconciledSettlements, 1);
  assert.equal(summary.amountAtomic, "50000");
  assert.deepEqual({ ...summary.byClass.validation }, { settlements: 1, amountAtomic: "50000" });
  assert.deepEqual({ ...summary.byRoute["/extract"] }, { settlements: 1, amountAtomic: "50000" });
  assert.equal(JSON.stringify(summary).includes(REFERENCE), false);
  assert.equal(JSON.stringify(summary).includes(PAYER), false);
});

test("reclassifies an existing settlement summary from current payer policy without rewriting the ledger", () => {
  const ledger = `${JSON.stringify({
    schemaVersion: "samedaydesk.commerce-settlement-reconciliation.v1",
    state: "reconciled",
    sourceEventId: "event-owned-canary",
    route: "/enrich",
    paymentClass: "unclassified",
    settlementReference: REFERENCE,
    amountAtomic: "50000",
  })}\n`;
  const summary = summarizeCommerceSettlementLedger(ledger, {
    paymentClassBySourceEventId: new Map([["event-owned-canary", "internal"]]),
  });
  assert.deepEqual({ ...summary.byClass }, {
    internal: { settlements: 1, amountAtomic: "50000" },
  });
});

test("fails closed on duplicate references and canonical settlement mismatches", async () => {
  const duplicate = await reconcile([event(), event({ id: "event-2" })]);
  assert.deepEqual(duplicate.issues.map((item) => item.code), ["duplicate_paid_event_reference"]);
  assert.equal(duplicate.newRecords.length, 0);

  const unsuccessful = await reconcile([event()], receipt({ status: "reverted" }));
  assert.deepEqual(unsuccessful.issues.map((item) => item.code), ["transaction_unsuccessful"]);

  const wrongTreasury = await reconcile([event()], receipt({ to: "0x2222222222222222222222222222222222222222" }));
  assert.deepEqual(wrongTreasury.issues.map((item) => item.code), ["treasury_transfer_count_mismatch"]);

  const wrongAmount = await reconcile([event()], receipt({ amount: 49999n }));
  assert.deepEqual(wrongAmount.issues.map((item) => item.code), ["response_amount_mismatch"]);

  const wrongPayer = await reconcile([event()], receipt({ from: "0x3333333333333333333333333333333333333333" }));
  assert.deepEqual(wrongPayer.issues.map((item) => item.code), ["payer_continuity_mismatch"]);
});

test("does not reconcile a reference that is already in the private ledger", async () => {
  const first = await reconcile([event()]);
  const second = await reconcileCommerceSettlementEvents(
    JSON.stringify(event()),
    JSON.stringify(first.newRecords[0]),
    {
      actorSecret: SECRET,
      client: clientFor(receipt()),
      payerClasses: [{ address: PAYER, class: "validation" }],
      settlementEvidenceSince: "2026-08-09T13:49:54.000Z",
      treasury: TREASURY,
    },
  );
  assert.equal(second.alreadyReconciled, 1);
  assert.equal(second.newRecords.length, 0);
  assert.equal(second.issues.length, 0);
});
