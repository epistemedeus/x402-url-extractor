import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  ATTEMPT_RECEIPT_SCHEMA,
  RECEIPT_STAGES,
  buildAttemptReceipt,
  readAttemptReceipt,
  safeAttemptJson,
  unsignedIdentityFromPaymentPayload,
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
import {
  createFakeReconcileClient,
  reconcileAttemptReceipt,
} from "../src/reconcile.mjs";
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
      bodyDigest: "sha256:deadbeef",
    },
    stage: overrides.stage || RECEIPT_STAGES.READY_BEFORE_SEND,
  });
}

function transferLog({ from, to, value }) {
  return {
    address: LIVE_ASSET,
    data: encodeAbiParameters(parseAbiParameters("uint256"), [BigInt(value)]),
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x000000000000000000000000${from.slice(2).toLowerCase()}`,
      `0x000000000000000000000000${to.slice(2).toLowerCase()}`,
    ],
  };
}

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

test("receipt write failure blocks paid send", async () => {
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
  assert.throws(() => validateAttemptReceipt({ ...base, signature: "0xabc" }), /signature/);
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

test("reconcile reports used vs unused/expired and keeps confirmation separate from finality", async () => {
  const receipt = sampleReceipt({
    identity: sampleIdentity({ validBefore: "100", validAfter: "0" }),
  });
  const unused = await reconcileAttemptReceipt({
    receipt: { ...receipt, validBefore: String(Math.floor(Date.now() / 1000) + 600) },
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => false,
      getBlockNumber: async () => 5000n,
      getBlock: async ({ blockTag }) => ({
        number: blockTag === "finalized" ? 4900n : blockTag === "safe" ? 4950n : 5000n,
      }),
      getLogs: async () => [],
    }),
  });
  assert.equal(unused.authorization.used, false);
  assert.equal(unused.decision, "unused_within_window");
  assert.equal(unused.claims.deliveredOutput, false);
  assert.equal(unused.claims.retryAuthorized, false);

  const expired = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    now: () => new Date(200_000 * 1000),
    client: createFakeReconcileClient({
      readContract: async () => false,
      getBlockNumber: async () => 5000n,
    }),
  });
  assert.equal(expired.decision, "unused_expired");

  const identity = sampleIdentity();
  const txHash = `0x${"11".repeat(32)}`;
  const usedMatched = await reconcileAttemptReceipt({
    receipt: sampleReceipt({ identity }),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => true,
      getBlockNumber: async () => 5210n,
      getBlock: async ({ blockTag }) => ({
        number: blockTag === "finalized" ? 5100n : blockTag === "safe" ? 5150n : 5210n,
      }),
      getLogs: async () => [{
        transactionHash: txHash,
        blockNumber: 5190n,
        logIndex: 0,
      }],
      getTransactionReceipt: async () => ({
        blockNumber: 5190n,
        logs: [transferLog({
          from: identity.payer,
          to: identity.payee,
          value: identity.amountAtomic,
        })],
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

  const usedNoMatch = await reconcileAttemptReceipt({
    receipt: sampleReceipt(),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => true,
      getBlockNumber: async () => 100n,
      getLogs: async () => [],
    }),
  });
  assert.equal(usedNoMatch.decision, "used_unmatched_settlement");
  assert.equal(usedNoMatch.claims.deliveredOutput, false);
  assert.match(usedNoMatch.uncertainty.join(" "), /not delivered output/i);
});

test("unavailable oversized and timeout RPC surfaces are explicit", async () => {
  const receipt = sampleReceipt();
  const unavailable = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => { throw new Error("fetch failed: timeout"); },
    }),
  });
  assert.equal(unavailable.decision, "rpc_unavailable");
  assert.equal(unavailable.authorization.used, null);

  const oversized = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => { throw new Error("RPC response oversized / 413 payload too large"); },
    }),
  });
  assert.equal(oversized.decision, "rpc_unavailable");

  const nonBoolean = await reconcileAttemptReceipt({
    receipt,
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => "yes",
    }),
  });
  assert.equal(nonBoolean.decision, "unsupported_or_unknown");
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
    import { createFakeReconcileClient, reconcileAttemptReceipt } from ${JSON.stringify(fileURLToPath(new URL("../src/reconcile.mjs", import.meta.url)))};
    const receipt = readAttemptReceipt(${JSON.stringify(receiptPath)});
    const result = await reconcileAttemptReceipt({
      receipt,
      rpcUrl: "https://rpc.example",
      client: createFakeReconcileClient({ readContract: async () => false, getBlockNumber: async () => 1n }),
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
  assert.match(cliReconcile.stdout + cliReconcile.stderr, /rpc_unavailable|rpc_error|ECONNREFUSED|fetch failed|timeout|network/i);
  rmSync(dir, { recursive: true, force: true });
});

test("chain usage cannot be inferred as delivery or retry permission", async () => {
  const result = await reconcileAttemptReceipt({
    receipt: sampleReceipt(),
    rpcUrl: "https://rpc.example",
    client: createFakeReconcileClient({
      readContract: async () => true,
      getBlockNumber: async () => 10n,
      getLogs: async () => [],
    }),
  });
  assert.equal(result.authorization.used, true);
  assert.equal(result.claims.deliveredOutput, false);
  assert.equal(result.claims.retryAuthorized, false);
  assert.equal(result.claims.respendAuthorized, false);
  assert.equal(result.boundary.retry, false);
});
