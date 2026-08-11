import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_SOLANA_USDC,
  normalizeSolanaTransactionReceiptInput,
  solanaTransactionReceipt,
} from "./solana-transaction-receipt.mjs";

const SIGNATURE = "3CjY38avdggKZbKfu2BmFYN4MUTiiNX27c8dHzPW79PrAx3huB9Pa6AfwW6sT4biax3y22z8toyLzmjtCc2QGNZn";
const PAYER = "5KvVdQ2EVGD4gXhgY3cC2D5YVR7qJvhETR4vQzUH9jSd";
const RECIPIENT = "4n7G8c3cRU3fP5x62uGTCtfuPtLJkyGvGh5kXGdZyJfN";

function response(result, { ok = true } = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  });
}

function fixture({ amount = "2000", error = null } = {}) {
  return {
    slot: 438431606,
    blockTime: 1786464000,
    meta: {
      err: error,
      fee: 5000,
      preTokenBalances: [
        { accountIndex: 1, mint: CANONICAL_SOLANA_USDC, owner: PAYER, uiTokenAmount: { amount: "10000", decimals: 6 } },
        { accountIndex: 2, mint: CANONICAL_SOLANA_USDC, owner: RECIPIENT, uiTokenAmount: { amount: "5000", decimals: 6 } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: CANONICAL_SOLANA_USDC, owner: PAYER, uiTokenAmount: { amount: String(10000n - BigInt(amount)), decimals: 6 } },
        { accountIndex: 2, mint: CANONICAL_SOLANA_USDC, owner: RECIPIENT, uiTokenAmount: { amount: String(5000n + BigInt(amount)), decimals: 6 } },
      ],
    },
    transaction: { signatures: [SIGNATURE], message: { accountKeys: [] } },
  };
}

test("normalizes one exact Solana settlement claim", () => {
  assert.deepEqual(normalizeSolanaTransactionReceiptInput({
    signature: SIGNATURE,
    recipient: RECIPIENT,
    amountAtomic: "2000",
    payer: PAYER,
  }), {
    signature: SIGNATURE,
    mint: CANONICAL_SOLANA_USDC,
    recipient: RECIPIENT,
    amountAtomic: "2000",
    payer: PAYER,
  });
  assert.throws(() => normalizeSolanaTransactionReceiptInput({ signature: "bad" }), /64-byte base58/);
  assert.throws(() => normalizeSolanaTransactionReceiptInput({ signature: SIGNATURE, amountAtomic: "1" }), /recipient is required/);
});

test("returns a verified request-bound canonical-USDC receipt", async () => {
  const result = await solanaTransactionReceipt({
    signature: SIGNATURE,
    recipient: RECIPIENT,
    amountAtomic: "2000",
    payer: PAYER,
  }, {
    fetchImpl: async () => response(fixture()),
    rpcUrls: ["https://rpc.example"],
    now: () => new Date("2026-08-11T21:12:00Z"),
  });
  assert.equal(result.decision, "verified");
  assert.equal(result.verification.matched, true);
  assert.equal(result.transaction.status, "success");
  assert.deepEqual(result.canonicalUsdcOwnerDeltas.map((entry) => [entry.owner, entry.amountDeltaAtomic]), [
    [RECIPIENT, "2000"],
    [PAYER, "-2000"],
  ].sort((left, right) => left[0].localeCompare(right[0])));
  assert.equal(result.boundary.walletAccessed, false);
  assert.equal(result.boundary.rawInstructionsReturned, false);
});

test("returns deterministic mismatch evidence", async () => {
  const result = await solanaTransactionReceipt({
    signature: SIGNATURE,
    recipient: RECIPIENT,
    amountAtomic: "3000",
    payer: PAYER,
  }, {
    fetchImpl: async () => response(fixture()),
    rpcUrls: ["https://rpc.example"],
  });
  assert.equal(result.decision, "not_verified");
  assert.equal(result.verification.matched, false);
  assert.deepEqual(result.findings.map((entry) => entry.code), ["recipient_amount_mismatch", "payer_amount_mismatch"]);
});

test("distinguishes not found from exhausted RPCs", async () => {
  const missing = await solanaTransactionReceipt({ signature: SIGNATURE }, {
    fetchImpl: async () => response(null),
    rpcUrls: ["https://rpc.example"],
  });
  assert.equal(missing.decision, "not_found");
  assert.equal(missing.ok, true);

  const unavailable = await solanaTransactionReceipt({ signature: SIGNATURE }, {
    fetchImpl: async () => response(null, { ok: false }),
    rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
  });
  assert.equal(unavailable.decision, "rpc_unavailable");
  assert.equal(unavailable.ok, false);
});

test("uses a later public RPC after a bounded failure", async () => {
  let calls = 0;
  const result = await solanaTransactionReceipt({ signature: SIGNATURE }, {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(null, { ok: false }) : response(fixture());
    },
    rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
  });
  assert.equal(result.decision, "found");
  assert.equal(calls, 2);
});
