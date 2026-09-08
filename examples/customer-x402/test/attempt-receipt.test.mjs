import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  ATTEMPT_RECEIPT_SCHEMA,
  RECEIPT_STAGES,
  buildAttemptReceipt,
  readAttemptReceipt,
  safeAttemptJson,
  unsignedIdentityFromPaymentPayload,
  updateAttemptReceipt,
  validateAttemptReceipt,
  writeAttemptReceipt,
} from "../src/attempt-receipt.mjs";
import {
  DEFAULT_AUTHORIZATION,
  DEFAULT_BATCH_AUTHORIZATION,
  LIVE_ASSET,
  LIVE_NETWORK,
  LIVE_RECIPIENT,
  OUTCOMES,
} from "../src/constants.mjs";
import { normalizeAuthorization } from "../src/authorization.mjs";
import { runAuthorizedPurchase } from "../src/purchase.mjs";
import { reconcileAttemptReceipt } from "../src/reconcile.mjs";
import { createFakeReconcileClient } from "../fixtures/fake-reconcile-client.mjs";
import {
  FIXTURE_DIGEST,
  authorizationCanceledLog,
  authorizationUsedLog,
  transferLog,
} from "../fixtures/rpc-server.mjs";
import {
  buildChallenge,
  createBatchFixtureFetch,
  createFixtureFetch,
} from "../fixtures/transport.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "customer-x402-receipt-"));
}

function sampleIdentity(overrides = {}) {
  return {
    scheme: "exact",
    assetTransferMethod: "eip3009",
    x402Version: 2,
    network: LIVE_NETWORK,
    asset: LIVE_ASSET,
    assetName: "USD Coin",
    assetVersion: "2",
    payer: "0x1111111111111111111111111111111111111111",
    payee: LIVE_RECIPIENT,
    amountAtomic: "10000",
    nonce: `0x${"ab".repeat(32)}`,
    validAfter: "0",
    validBefore: "2000000000",
    paymentIdentifier: "pay_fixture_payment_id_01",
    ...overrides,
  };
}

function sampleReceipt(overrides = {}) {
  return buildAttemptReceipt({
    identity: sampleIdentity(overrides.identity),
    request: overrides.request || {
      method: "POST",
      url: "https://agents.samedaydesk.com/extract/batch",
      bodyDigest: FIXTURE_DIGEST,
    },
    stage: overrides.stage || RECEIPT_STAGES.READY_BEFORE_SEND,
  });
}

const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const TX_HASH = `0x${"11".repeat(32)}`;

test("no-receipt purchase path stays compatible and honest about missing identity", async () => {
  const auth = normalizeAuthorization(DEFAULT_BATCH_AUTHORIZATION);
  const { fetchImpl, calls } = createBatchFixtureFetch({ authorization: auth });
  const account = privateKeyToAccount(generatePrivateKey());
  const result = await runAuthorizedPurchase({
    authorization: auth, account, fetchImpl, approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.USEFUL_DELIVERED);
  assert.equal(result.attemptReceiptWritten, false);
  assert.equal(result.attemptReceiptPath, null);
  assert.match(result.boundary, /Without --attempt-receipt/);
  assert.equal(calls.filter((c) => c.hasPaymentSignature).length, 1);
});

test("GET and batch POST persist unsigned identity before the single paid send", async () => {
  for (const kind of ["get", "batch"]) {
    const dir = tempDir();
    const receiptPath = join(dir, "attempt.json");
    try {
      const auth = normalizeAuthorization(
        kind === "get" ? DEFAULT_AUTHORIZATION : DEFAULT_BATCH_AUTHORIZATION,
      );
      const account = privateKeyToAccount(generatePrivateKey());
      const { fetchImpl, calls } = kind === "get"
        ? createFixtureFetch()
        : createBatchFixtureFetch({ authorization: auth });
      let paidSeen = false;
      const gatedFetch = async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const paid = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
        if (paid) {
          paidSeen = true;
          const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
          assert.equal(receipt.schema, ATTEMPT_RECEIPT_SCHEMA);
          assert.equal(receipt.stage, RECEIPT_STAGES.PAID_SEND_DISPATCHED);
          assert.ok(/^0x[0-9a-f]{64}$/.test(receipt.nonce));
          assert.match(receipt.validBefore, /^\d+$/);
          assert.equal(receipt.payer.toLowerCase(), account.address.toLowerCase());
          assert.equal("signature" in receipt, false);
          if (kind === "batch") assert.ok(receipt.paymentIdentifier);
          if (kind === "batch") assert.equal(receipt.request.bodyDigest, auth.bodyDigest);
          if (kind === "get") assert.equal(receipt.request.bodyDigest, null);
        }
        return fetchImpl(input, init);
      };
      const result = await runAuthorizedPurchase({
        authorization: auth,
        account,
        fetchImpl: gatedFetch,
        approve: true,
        attemptReceiptPath: receiptPath,
      });
      assert.equal(paidSeen, true);
      assert.equal(result.attemptReceiptWritten, true);
      assert.equal(result.paymentSent, true);
      assert.ok(
        result.outcome === OUTCOMES.VALID_DELIVERED || result.outcome === OUTCOMES.USEFUL_DELIVERED,
      );
      const finalReceipt = readAttemptReceipt(receiptPath);
      assert.equal(finalReceipt.stage, RECEIPT_STAGES.PAID_RESPONSE_OBSERVED);
      assert.equal(calls.filter((c) => c.hasPaymentSignature).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("receipt write failure blocks paid send and refuses overwrite", async () => {
  const dir = tempDir();
  const blocked = join(dir, "blocked");
  writeFileSync(blocked, "not-a-directory");
  const receiptPath = join(blocked, "attempt.json");
  const auth = normalizeAuthorization(DEFAULT_AUTHORIZATION);
  const { fetchImpl, calls } = createFixtureFetch();
  const account = privateKeyToAccount(generatePrivateKey());
  const result = await runAuthorizedPurchase({
    authorization: auth,
    account,
    fetchImpl,
    approve: true,
    attemptReceiptPath: receiptPath,
  });
  assert.equal(result.paymentSent, false);
  assert.equal(result.attemptReceiptWritten, false);
  assert.equal(result.outcome, OUTCOMES.UNKNOWN);
  assert.match(result.message, /attempt receipt failed before paid send/);
  assert.equal(calls.filter((c) => c.hasPaymentSignature).length, 0);

  const existing = join(dir, "existing.json");
  writeAttemptReceipt(existing, sampleReceipt());
  assert.throws(() => writeAttemptReceipt(existing, sampleReceipt()), /persist|exists|EEXIST|failed/i);
  rmSync(dir, { recursive: true, force: true });
});

test("transport timeout after dispatch preserves receipt stage and unknown settlement", async () => {
  const dir = tempDir();
  const receiptPath = join(dir, "attempt.json");
  const auth = normalizeAuthorization(DEFAULT_AUTHORIZATION);
  const challenge = buildChallenge();
  const account = privateKeyToAccount(generatePrivateKey());
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const paid = request.headers.has("payment-signature") || request.headers.has("PAYMENT-SIGNATURE");
    if (!paid) {
      return new Response(JSON.stringify(challenge), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "payment-required": encodePaymentRequiredHeader(challenge),
        },
      });
    }
    throw new Error("transport disconnected");
  };
  const result = await runAuthorizedPurchase({
    authorization: auth,
    account,
    fetchImpl,
    approve: true,
    attemptReceiptPath: receiptPath,
  });
  assert.equal(result.outcome, OUTCOMES.UNKNOWN);
  assert.equal(result.paymentSent, true);
  const receipt = readAttemptReceipt(receiptPath);
  assert.equal(receipt.stage, RECEIPT_STAGES.PAID_SEND_DISPATCHED);
  assert.equal(receipt.settlementState, "unknown");
  assert.ok(receipt.nonce);
  assert.ok(receipt.validBefore);
  rmSync(dir, { recursive: true, force: true });
});

test("crash-stage fixture remains readable with dispatched unknown settlement", () => {
  const receipt = readAttemptReceipt(
    fileURLToPath(new URL("../fixtures/crash-stage-receipt.json", import.meta.url)),
  );
  assert.equal(receipt.stage, RECEIPT_STAGES.PAID_SEND_DISPATCHED);
  assert.equal(receipt.settlementState, "unknown");
  assert.equal(receipt.request.method, "POST");
  assert.match(receipt.nonce, /^0x[0-9a-f]{64}$/);
  assert.match(receipt.request.bodyDigest, /^sha256:[0-9a-f]{64}$/);
});

test("malformed receipts and incorrect chain/asset/payer/nonce/amount are refused before RPC", async () => {
  const base = sampleReceipt();
  await assert.rejects(
    () => reconcileAttemptReceipt({ receipt: { ...base, schema: "nope" }, rpcUrl: "https://rpc.example" }),
    /schema/,
  );
  assert.throws(() => validateAttemptReceipt({ ...base, network: "base" }), /eip155/);
  assert.throws(() => validateAttemptReceipt({ ...base, asset: "0xdead" }), /asset/);
  assert.throws(() => validateAttemptReceipt({ ...base, payer: "not-an-address" }), /payer/);
  assert.throws(() => validateAttemptReceipt({ ...base, nonce: "0x1234" }), /nonce/);
  assert.throws(() => validateAttemptReceipt({ ...base, amountAtomic: "-1" }), /amount/);
  assert.throws(() => validateAttemptReceipt({ ...base, signature: "0xabc" }), /signature|allowlisted/);
  assert.throws(() => validateAttemptReceipt({ ...base, validAfter: "200", validBefore: "100" }), /validAfter/);
  assert.throws(
    () => validateAttemptReceipt({
      ...base,
      request: { ...base.request, bodyDigest: "not-a-digest" },
    }),
    /bodyDigest/,
  );
  let contacted = false;
  await assert.rejects(() => reconcileAttemptReceipt({
    receipt: { ...base, scheme: "upto" },
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => { contacted = true; return false; },
    }),
  }), /scheme|scheme|unsupported/i);
  assert.equal(contacted, false);
});

test("stage update cannot rewrite request or identity and boundary secrets are not copied", () => {
  const dir = tempDir();
  const path = join(dir, "receipt.json");
  const value = sampleReceipt();
  writeAttemptReceipt(path, value);
  assert.throws(
    () => updateAttemptReceipt(path, { request: { url: "https://example.org/foreign" } }),
    /immutable|request/,
  );
  assert.equal(readAttemptReceipt(path).request.url, value.request.url);
  const polluted = validateAttemptReceipt({
    ...value,
    boundary: { signature: "SENTINEL_PRIVATE_MATERIAL", purpose: "x" },
  });
  assert.equal(JSON.stringify(polluted).includes("SENTINEL_PRIVATE_MATERIAL"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("reconcile reports used vs unused/expired/canceled and keeps confirmation separate from finality", async () => {
  const receipt = sampleReceipt({
    identity: sampleIdentity({ validBefore: "100", validAfter: "0" }),
  });
  const unused = await reconcileAttemptReceipt({
    receipt: { ...receipt, validBefore: String(Math.floor(Date.now() / 1000) + 600) },
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => false,
      getBlockNumber: async () => 5000n,
      getBlock: async ({ blockTag, blockNumber }) => ({
        number: blockNumber ?? (blockTag === "finalized" ? 4900n : blockTag === "safe" ? 4950n : 5000n),
        hash: BLOCK_HASH,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      }),
      getLogs: async () => [],
    }),
  });
  assert.equal(unused.authorization.used, false);
  assert.equal(unused.decision, "unused_within_window");
  assert.equal(unused.claims.deliveredOutput, false);
  assert.equal(unused.claims.retryAuthorized, false);
  assert.equal(unused.observedBlock.hash, BLOCK_HASH);

  const expired = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    now: () => new Date(200_000 * 1000),
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => false,
      getBlock: async () => ({
        number: 5000n,
        hash: BLOCK_HASH,
        timestamp: 200_000n,
      }),
    }),
  });
  assert.equal(expired.decision, "unused_expired");
  assert.equal(expired.expiry.chainTime.expired, true);

  const identity = sampleIdentity();
  const usedMatched = await reconcileAttemptReceipt({
    receipt: sampleReceipt({ identity }),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => true,
      getBlockNumber: async () => 5210n,
      getBlock: async ({ blockTag, blockNumber }) => ({
        number: blockNumber ?? (blockTag === "finalized" ? 5100n : blockTag === "safe" ? 5150n : 5210n),
        hash: BLOCK_HASH,
        timestamp: 1_700_000_000n,
      }),
      getLogs: async ({ event }) => {
        const name = event?.name || event?.type;
        if (String(event).includes("Canceled") || name === "AuthorizationCanceled") return [];
        // event is parsed item; distinguish by inputs/name
        if (event?.name === "AuthorizationCanceled") return [];
        return [authorizationUsedLog({
          address: LIVE_ASSET,
          authorizer: identity.payer,
          nonce: identity.nonce,
          transactionHash: TX_HASH,
          blockNumber: 5190n,
          blockHash: BLOCK_HASH,
        })];
      },
      getTransactionReceipt: async () => ({
        status: "success",
        transactionHash: TX_HASH,
        blockNumber: 5190n,
        blockHash: BLOCK_HASH,
        logs: [
          authorizationUsedLog({
            address: LIVE_ASSET,
            authorizer: identity.payer,
            nonce: identity.nonce,
            transactionHash: TX_HASH,
            blockNumber: 5190n,
            blockHash: BLOCK_HASH,
          }),
          transferLog({
            address: LIVE_ASSET,
            from: identity.payer,
            to: identity.payee,
            value: identity.amountAtomic,
          }),
        ],
      }),
    }),
  });
  assert.equal(usedMatched.authorization.used, true);
  assert.equal(usedMatched.settlement.matched, true);
  assert.equal(usedMatched.finality.confirmed, true);
  assert.equal(usedMatched.finality.finalized, false);
  assert.equal(usedMatched.claims.deliveredOutput, false);
  assert.equal(usedMatched.claims.retryAuthorized, false);
  assert.notEqual(usedMatched.decision, "used_settlement_finalized");

  const canceled = await reconcileAttemptReceipt({
    receipt: sampleReceipt({ identity }),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => true,
      getBlock: async () => ({ number: 100n, hash: BLOCK_HASH, timestamp: 1_700_000_000n }),
      getLogs: async ({ event }) => {
        if (event?.name === "AuthorizationCanceled") {
          return [authorizationCanceledLog({
            address: LIVE_ASSET,
            authorizer: identity.payer,
            nonce: identity.nonce,
            transactionHash: TX_HASH,
            blockNumber: 90n,
            blockHash: BLOCK_HASH,
          })];
        }
        return [];
      },
    }),
  });
  assert.equal(canceled.decision, "canceled_unsettled");
  assert.equal(canceled.settlement.status, "canceled");
  assert.equal(canceled.claims.deliveredOutput, false);

  const usedNoMatch = await reconcileAttemptReceipt({
    receipt: sampleReceipt(),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => true,
      getBlock: async () => ({ number: 100n, hash: BLOCK_HASH, timestamp: 1_700_000_000n }),
      getLogs: async () => [],
    }),
  });
  assert.equal(usedNoMatch.decision, "used_unmatched_settlement");
  assert.equal(usedNoMatch.claims.deliveredOutput, false);
  assert.match(usedNoMatch.uncertainty.join(" "), /not payment|not delivered output/i);
});

test("unavailable oversized and timeout RPC surfaces are explicit without secret leakage", async () => {
  const receipt = sampleReceipt();
  const unavailable = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => { throw new Error("fetch failed: timeout"); },
    }),
  });
  assert.equal(unavailable.decision, "rpc_unavailable");
  assert.equal(unavailable.authorization.used, null);
  assert.equal(unavailable.message, "rpc_timeout");

  const oversized = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      getBlock: async () => ({ number: 1n, hash: BLOCK_HASH, timestamp: 1n }),
      readContract: async () => { throw new Error("RPC response oversized / 413 payload too large"); },
    }),
  });
  assert.equal(oversized.decision, "rpc_unavailable");
  assert.equal(oversized.message, "rpc_response_too_large");

  const nonBoolean = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      getBlock: async () => ({ number: 1n, hash: BLOCK_HASH, timestamp: 1n }),
      readContract: async () => "yes",
    }),
  });
  assert.equal(nonBoolean.decision, "unsupported_or_unknown");

  const text = safeAttemptJson(oversized);
  assert.equal(text.includes("413 payload too large"), false);
  assert.equal(text.includes("private"), false);
});

test("wrong chain is rejected before authorizationState", async () => {
  let reads = 0;
  const client = createFakeReconcileClient({
    getChainId: async () => 1,
    readContract: async () => { reads += 1; return false; },
  });
  const result = await reconcileAttemptReceipt({
    receipt: sampleReceipt(),
    client,
    rpcUrl: "https://rpc.example",
  });
  assert.equal(reads, 0);
  assert.equal(result.decision, "chain_mismatch");
  assert.notEqual(result.authorization?.used, false);
});

test("reverted transaction and duplicate transfers do not count as exact settlement", async () => {
  const identity = sampleIdentity();
  const reverted = await reconcileAttemptReceipt({
    receipt: sampleReceipt({ identity }),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => true,
      getBlock: async () => ({ number: 100n, hash: BLOCK_HASH, timestamp: 1n }),
      getLogs: async ({ event }) => event?.name === "AuthorizationUsed"
        ? [authorizationUsedLog({
          address: LIVE_ASSET,
          authorizer: identity.payer,
          nonce: identity.nonce,
          transactionHash: TX_HASH,
          blockNumber: 90n,
          blockHash: BLOCK_HASH,
        })]
        : [],
      getTransactionReceipt: async () => ({
        status: "reverted",
        transactionHash: TX_HASH,
        blockNumber: 90n,
        blockHash: BLOCK_HASH,
        logs: [],
      }),
    }),
  });
  assert.equal(reverted.settlement.matched, false);
  assert.match(reverted.settlement.reason, /not_successful|reverted/i);

  const duplicate = await reconcileAttemptReceipt({
    receipt: sampleReceipt({ identity }),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => true,
      getBlock: async ({ blockNumber }) => ({
        number: blockNumber ?? 100n,
        hash: BLOCK_HASH,
        timestamp: 1n,
      }),
      getLogs: async ({ event }) => event?.name === "AuthorizationUsed"
        ? [authorizationUsedLog({
          address: LIVE_ASSET,
          authorizer: identity.payer,
          nonce: identity.nonce,
          transactionHash: TX_HASH,
          blockNumber: 90n,
          blockHash: BLOCK_HASH,
        })]
        : [],
      getTransactionReceipt: async () => ({
        status: "success",
        transactionHash: TX_HASH,
        blockNumber: 90n,
        blockHash: BLOCK_HASH,
        logs: [
          authorizationUsedLog({
            address: LIVE_ASSET,
            authorizer: identity.payer,
            nonce: identity.nonce,
            transactionHash: TX_HASH,
            blockNumber: 90n,
            blockHash: BLOCK_HASH,
          }),
          transferLog({
            address: LIVE_ASSET,
            from: identity.payer,
            to: identity.payee,
            value: identity.amountAtomic,
          }),
          transferLog({
            address: LIVE_ASSET,
            from: identity.payer,
            to: identity.payee,
            value: identity.amountAtomic,
          }),
        ],
      }),
    }),
  });
  assert.equal(duplicate.settlement.matched, false);
  assert.match(duplicate.settlement.reason, /ambiguous_matching_transfers/);
});

test("canonical block hash mismatch refuses settlement finality claims", async () => {
  const identity = sampleIdentity();
  const result = await reconcileAttemptReceipt({
    receipt: sampleReceipt({ identity }),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => true,
      getBlock: async ({ blockNumber }) => ({
        number: blockNumber ?? 100n,
        hash: blockNumber === 90n ? `0x${"ee".repeat(32)}` : BLOCK_HASH,
        timestamp: 1n,
      }),
      getLogs: async ({ event }) => event?.name === "AuthorizationUsed"
        ? [authorizationUsedLog({
          address: LIVE_ASSET,
          authorizer: identity.payer,
          nonce: identity.nonce,
          transactionHash: TX_HASH,
          blockNumber: 90n,
          blockHash: BLOCK_HASH,
        })]
        : [],
      getTransactionReceipt: async () => ({
        status: "success",
        transactionHash: TX_HASH,
        blockNumber: 90n,
        blockHash: BLOCK_HASH,
        logs: [
          authorizationUsedLog({
            address: LIVE_ASSET,
            authorizer: identity.payer,
            nonce: identity.nonce,
            transactionHash: TX_HASH,
            blockNumber: 90n,
            blockHash: BLOCK_HASH,
          }),
          transferLog({
            address: LIVE_ASSET,
            from: identity.payer,
            to: identity.payee,
            value: identity.amountAtomic,
          }),
        ],
      }),
    }),
  });
  assert.equal(result.settlement.matched, false);
  assert.match(result.settlement.reason, /canonical_block_hash_mismatch/);
});

test("unsupported provider payment shapes return explicit unsupported without guessing", () => {
  const permit = unsignedIdentityFromPaymentPayload({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: LIVE_NETWORK,
      asset: LIVE_ASSET,
      extra: { assetTransferMethod: "permit2" },
    },
    payload: { authorization: {}, signature: "0x" },
  });
  assert.equal(permit.ok, false);
  assert.equal(permit.reason, "unsupported_asset_transfer");

  const badVersion = unsignedIdentityFromPaymentPayload({
    x402Version: 1,
    accepted: { scheme: "exact" },
    payload: {},
  });
  assert.equal(badVersion.ok, false);
  assert.equal(badVersion.reason, "unsupported_version");
});

test("receipt file stays private and safeAttemptJson omits secrets", () => {
  const dir = tempDir();
  const path = join(dir, "attempt.json");
  const receipt = writeAttemptReceipt(path, sampleReceipt());
  assert.equal(statSync(path).mode & 0o077, 0);
  const text = safeAttemptJson({
    ...receipt,
    signature: `0x${"ab".repeat(65)}`,
    privateKey: generatePrivateKey(),
  });
  assert.equal(text.includes("ab".repeat(65)), false);
  assert.match(text, /\[redacted\]/);
  assert.match(text, new RegExp(receipt.nonce));
  rmSync(dir, { recursive: true, force: true });
});

test("published illustrative sample validates with synthetic nonce and digest", () => {
  const sample = JSON.parse(readFileSync(
    fileURLToPath(new URL("../results/attempt-receipt.sample.json", import.meta.url)),
    "utf8",
  ));
  const validated = validateAttemptReceipt(sample);
  assert.match(validated.nonce, /^0x[0-9a-f]{64}$/);
  assert.match(validated.request.bodyDigest, /^sha256:[0-9a-f]{64}$/);
});

test("CLI reconcile and purchase --attempt-receipt exercise exported commands", () => {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const dir = tempDir();
  const receiptPath = join(dir, "cli-attempt.json");
  const env = {
    PATH: process.env.PATH,
    NODE_OPTIONS: `--import=${fileURLToPath(new URL("cli-fixture.mjs", import.meta.url))}`,
    CUSTOMER_X402_PRIVATE_KEY: generatePrivateKey(),
  };
  const purchase = spawnSync(process.execPath, [
    "bin/cli.mjs", "--approve",
    "--authorization", "./fixtures/authorization-batch.json",
    "--private-key-env", "CUSTOMER_X402_PRIVATE_KEY",
    "--attempt-receipt", receiptPath,
  ], { cwd, env, encoding: "utf8", timeout: 15000 });
  assert.equal(purchase.status, 0, purchase.stderr + purchase.stdout);
  assert.match(purchase.stdout, /"outcome": "useful_delivered"/);
  assert.equal(purchase.stdout.includes(env.CUSTOMER_X402_PRIVATE_KEY), false);
  const receipt = readAttemptReceipt(receiptPath);
  assert.equal(receipt.stage, RECEIPT_STAGES.PAID_RESPONSE_OBSERVED);

  const harness = join(dir, "reconcile-harness.mjs");
  writeFileSync(harness, `
    import { readAttemptReceipt, safeAttemptJson } from ${JSON.stringify(fileURLToPath(new URL("../src/attempt-receipt.mjs", import.meta.url)))};
    import { reconcileAttemptReceipt } from ${JSON.stringify(fileURLToPath(new URL("../src/reconcile.mjs", import.meta.url)))};
    import { createFakeReconcileClient } from ${JSON.stringify(fileURLToPath(new URL("../fixtures/fake-reconcile-client.mjs", import.meta.url)))};
    const receipt = readAttemptReceipt(${JSON.stringify(receiptPath)});
    const result = await reconcileAttemptReceipt({
      receipt,
      rpcUrl: "https://rpc.example",
      client: createFakeReconcileClient({
        getChainId: async () => 8453,
        readContract: async () => false,
        getBlock: async () => ({ number: 1n, hash: "0x${"ab".repeat(32)}", timestamp: 1_700_000_000n }),
      }),
    });
    console.log(safeAttemptJson(result));
    if (result.claims.deliveredOutput || result.claims.retryAuthorized) process.exit(3);
  `);
  const recon = spawnSync(process.execPath, [harness], { encoding: "utf8", timeout: 10000 });
  assert.equal(recon.status, 0, recon.stderr);
  assert.match(recon.stdout, /"used": false/);
  assert.match(recon.stdout, /"deliveredOutput": false/);

  const cliReconcile = spawnSync(process.execPath, [
    "bin/cli.mjs", "--reconcile",
    "--attempt-receipt", receiptPath,
    "--rpc-url", "https://127.0.0.1:1",
  ], { cwd, encoding: "utf8", timeout: 10000 });
  assert.equal(cliReconcile.status, 2, cliReconcile.stderr + cliReconcile.stdout);
  assert.match(cliReconcile.stdout + cliReconcile.stderr, /rpc_unavailable|rpc_error|rpc_timeout|chain_mismatch/i);
  assert.equal((cliReconcile.stdout + cliReconcile.stderr).includes("PRIVATE"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("chain usage cannot be inferred as delivery or retry permission", async () => {
  const result = await reconcileAttemptReceipt({
    receipt: sampleReceipt(),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      getChainId: async () => 8453,
      readContract: async () => true,
      getBlock: async () => ({ number: 10n, hash: BLOCK_HASH, timestamp: 1n }),
      getLogs: async () => [],
    }),
  });
  assert.equal(result.authorization.used, true);
  assert.equal(result.claims.deliveredOutput, false);
  assert.equal(result.claims.retryAuthorized, false);
  assert.equal(result.claims.respendAuthorized, false);
  assert.equal(result.boundary.retry, false);
});
