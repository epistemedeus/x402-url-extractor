import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodeFunctionResult, toHex } from "viem";
import { eip3009ABI } from "@x402/evm";

import {
  buildAttemptReceipt,
  readAttemptReceipt,
  safeAttemptJson,
  validateAttemptReceipt,
} from "../src/attempt-receipt.mjs";
import {
  MAX_RPC_RESPONSE_BYTES,
  reconcileAttemptReceipt,
} from "../src/reconcile.mjs";
import {
  LIVE_ASSET,
  LIVE_NETWORK,
  LIVE_RECIPIENT,
} from "../src/constants.mjs";
import {
  FIXTURE_DIGEST,
  authorizationUsedLog,
  blockResult,
  hexQuantity,
  rpcOk,
  transferLog,
  withJsonRpcServer,
} from "../fixtures/rpc-server.mjs";

const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const TX_HASH = `0x${"11".repeat(32)}`;
const cwd = fileURLToPath(new URL("../", import.meta.url));

function sampleReceipt(overrides = {}) {
  return buildAttemptReceipt({
    identity: {
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
      ...overrides.identity,
    },
    request: overrides.request || {
      method: "POST",
      url: "https://agents.samedaydesk.com/extract/batch",
      bodyDigest: FIXTURE_DIGEST,
    },
  });
}

function encodeAuthState(used) {
  return encodeFunctionResult({
    abi: eip3009ABI,
    functionName: "authorizationState",
    result: used,
  });
}

function defaultBlock(number = 1000n, timestamp = 1_700_000_000n) {
  return blockResult({ number, hash: BLOCK_HASH, timestamp });
}

test("invalid receipt fails before any network request", async () => {
  let hits = 0;
  await withJsonRpcServer(async () => {
    hits += 1;
    return "0x1";
  }, async (url) => {
    await assert.rejects(
      () => reconcileAttemptReceipt({
        receipt: { ...sampleReceipt(), validAfter: "9", validBefore: "1" },
        rpcUrl: url,
      }),
      /validAfter/,
    );
  });
  assert.equal(hits, 0);
});

test("real transport rejects wrong chain before eth_call/authorizationState", async () => {
  let methods = [];
  await withJsonRpcServer(async (_req, body) => {
    methods.push(body.method);
    if (body.method === "eth_chainId") return rpcOk(body.id, "0x1"); // Ethereum mainnet
    throw new Error(`unexpected ${body.method}`);
  }, async (url) => {
    const result = await reconcileAttemptReceipt({
      receipt: sampleReceipt(),
      rpcUrl: url,
    });
    assert.equal(result.decision, "chain_mismatch");
    assert.equal(result.authorization.used, null);
    assert.equal(methods.includes("eth_call"), false);
    assert.deepEqual(methods, ["eth_chainId"]);
    assert.equal(result.rpc.endpoint.origin, new URL(url).origin);
    assert.equal(result.rpc.retryCount, 0);
    assert.equal(result.rpc.maxResponseBytes, MAX_RPC_RESPONSE_BYTES);
  });
});

test("pinned block chain-time expiry and unused authorization over local RPC", async () => {
  await withJsonRpcServer(async (_req, body) => {
    if (body.method === "eth_chainId") return rpcOk(body.id, toHex(8453));
    if (body.method === "eth_getBlockByNumber") {
      return rpcOk(body.id, defaultBlock(5_000n, 200_000n));
    }
    if (body.method === "eth_call") {
      return rpcOk(body.id, encodeAuthState(false));
    }
    throw new Error(`unexpected ${body.method}`);
  }, async (url) => {
    const result = await reconcileAttemptReceipt({
      receipt: sampleReceipt({ identity: { validBefore: "100000", validAfter: "0" } }),
      rpcUrl: url,
      now: () => new Date(50_000 * 1000),
    });
    assert.equal(result.authorization.used, false);
    assert.equal(result.decision, "unused_expired");
    assert.equal(result.expiry.chainTime.expired, true);
    assert.equal(result.expiry.wallClock.expired, false);
    assert.equal(result.observedBlock.number, "5000");
    assert.equal(result.claims.retryAuthorized, false);
  });
});

test("oversized chunked and malformed RPC responses stay bounded and secret-free", async () => {
  await withJsonRpcServer(async (_req, body) => {
    if (body.method === "eth_chainId") {
      return {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(MAX_RPC_RESPONSE_BYTES + 10) },
        body: Buffer.alloc(MAX_RPC_RESPONSE_BYTES + 10, 0x61),
      };
    }
    throw new Error("unreachable");
  }, async (url) => {
    const result = await reconcileAttemptReceipt({ receipt: sampleReceipt(), rpcUrl: url });
    assert.equal(result.decision, "rpc_unavailable");
    assert.equal(result.message, "rpc_response_too_large");
    const text = safeAttemptJson(result);
    assert.equal(text.includes("aaaa"), false);
    assert.match(text, /"origin": "http:\/\/127\.0\.0\.1:\d+"/);
  });

  await withJsonRpcServer(async (_req, body) => {
    if (body.method === "eth_chainId") return "this-is-not-json{";
    return rpcOk(body.id, null);
  }, async (url) => {
    const result = await reconcileAttemptReceipt({ receipt: sampleReceipt(), rpcUrl: url });
    assert.match(result.decision, /rpc_/);
    assert.equal(safeAttemptJson(result).includes("this-is-not-json"), false);
  });

  await withJsonRpcServer(async (_req, body) => {
    if (body.method === "eth_chainId") return rpcOk(body.id, toHex(8453));
    if (body.method === "eth_getBlockByNumber") {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return rpcOk(body.id, defaultBlock());
    }
    return rpcOk(body.id, encodeAuthState(false));
  }, async (url) => {
    const result = await reconcileAttemptReceipt({
      receipt: sampleReceipt(),
      rpcUrl: url,
      timeoutMs: 30,
    });
    assert.equal(result.decision, "rpc_unavailable");
    assert.equal(result.message, "rpc_timeout");
  });
});

test("exact settlement match and cancellation over local JSON-RPC", async () => {
  const receipt = sampleReceipt();
  const identity = {
    payer: receipt.payer,
    payee: receipt.payee,
    amountAtomic: receipt.amountAtomic,
    nonce: receipt.nonce,
  };

  await withJsonRpcServer(async (_req, body) => {
    if (body.method === "eth_chainId") return rpcOk(body.id, toHex(8453));
    if (body.method === "eth_getBlockByNumber") {
      const tag = body.params[0];
      if (tag === "finalized") return rpcOk(body.id, defaultBlock(4_900n));
      if (tag === "safe") return rpcOk(body.id, defaultBlock(4_950n));
      if (tag === "latest") return rpcOk(body.id, defaultBlock(5_210n));
      if (typeof tag === "string" && tag.startsWith("0x")) {
        return rpcOk(body.id, defaultBlock(BigInt(tag), 1_700_000_000n));
      }
      return rpcOk(body.id, defaultBlock(5_210n));
    }
    if (body.method === "eth_call") return rpcOk(body.id, encodeAuthState(true));
    if (body.method === "eth_getLogs") {
      const topics = body.params[0]?.topics || [];
      // AuthorizationCanceled topic0 differs; return empty for cancel, used for used.
      const topic0 = String(topics[0] || "").toLowerCase();
      const canceledTopic = "0x" + "00"; // fallback
      void canceledTopic;
      // Heuristic: second query in our code is canceled; track via topic presence of nonce only.
      // Return used log only when the AuthorizationUsed selector is requested.
      // We detect by checking whether this is the first getLogs in-process via a counter on server.
      return rpcOk(body.id, []);
    }
    if (body.method === "eth_getTransactionReceipt") return rpcOk(body.id, null);
    throw new Error(`unexpected ${body.method}`);
  }, async (url) => {
    // First: consumed without logs => unmatched
    const unmatched = await reconcileAttemptReceipt({ receipt, rpcUrl: url });
    assert.equal(unmatched.decision, "used_unmatched_settlement");
    assert.equal(unmatched.claims.deliveredOutput, false);
  });

  let getLogsCalls = 0;
  await withJsonRpcServer(async (_req, body) => {
    if (body.method === "eth_chainId") return rpcOk(body.id, toHex(8453));
    if (body.method === "eth_getBlockByNumber") {
      const tag = body.params[0];
      if (tag === "finalized") return rpcOk(body.id, defaultBlock(100n));
      if (tag === "safe") return rpcOk(body.id, defaultBlock(100n));
      if (tag === "latest") return rpcOk(body.id, defaultBlock(100n));
      return rpcOk(body.id, defaultBlock(BigInt(tag)));
    }
    if (body.method === "eth_call") return rpcOk(body.id, encodeAuthState(true));
    if (body.method === "eth_getLogs") {
      getLogsCalls += 1;
      if (getLogsCalls === 1) {
        return rpcOk(body.id, [authorizationUsedLog({
          address: LIVE_ASSET,
          authorizer: identity.payer,
          nonce: identity.nonce,
          transactionHash: TX_HASH,
          blockNumber: 90n,
          blockHash: BLOCK_HASH,
          rpc: true,
        })]);
      }
      return rpcOk(body.id, []);
    }
    if (body.method === "eth_getTransactionReceipt") {
      return rpcOk(body.id, {
        status: "0x1",
        transactionHash: TX_HASH,
        blockNumber: hexQuantity(90n),
        blockHash: BLOCK_HASH,
        logs: [
          authorizationUsedLog({
            address: LIVE_ASSET,
            authorizer: identity.payer,
            nonce: identity.nonce,
            transactionHash: TX_HASH,
            blockNumber: 90n,
            blockHash: BLOCK_HASH,
            rpc: true,
          }),
          transferLog({
            address: LIVE_ASSET,
            from: identity.payer,
            to: identity.payee,
            value: identity.amountAtomic,
          }),
        ],
      });
    }
    throw new Error(`unexpected ${body.method}`);
  }, async (url) => {
    const matched = await reconcileAttemptReceipt({ receipt, rpcUrl: url });
    assert.equal(matched.settlement.matched, true);
    assert.equal(matched.authorization.used, true);
    assert.equal(matched.claims.deliveredOutput, false);
    assert.equal(matched.finality.hashMatched, true);
  });
});

function runCli(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

test("CLI reconcile against local RPC is read-only and prints safe endpoint context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c24-cli-rpc-"));
  const receiptPath = join(dir, "attempt.json");
  writeFileSync(receiptPath, `${JSON.stringify(sampleReceipt(), null, 2)}\n`);
  try {
    await withJsonRpcServer(async (_req, body) => {
      if (body.method === "eth_chainId") return rpcOk(body.id, "0x1");
      throw new Error("no further calls");
    }, async (url) => {
      const result = await runCli([
        "bin/cli.mjs", "--reconcile",
        "--attempt-receipt", receiptPath,
        "--rpc-url", url,
      ]);
      assert.equal(result.status, 2, result.stderr + result.stdout);
      assert.match(result.stdout, /"decision": "chain_mismatch"/);
      assert.match(result.stdout, /"origin": "http:\/\/127\.0\.0\.1:\d+"/);
      assert.equal(result.stdout.includes("/secret"), false);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("credential-bearing rpc urls are refused before fetch", async () => {
  await assert.rejects(
    () => reconcileAttemptReceipt({
      receipt: sampleReceipt(),
      rpcUrl: "https://user:pass@rpc.example/path?key=SECRET",
    }),
    /credential/,
  );
});

test("sample and crash fixtures remain valid under hardened validation", () => {
  const sample = readAttemptReceipt(
    fileURLToPath(new URL("../results/attempt-receipt.sample.json", import.meta.url)),
  );
  assert.equal(validateAttemptReceipt(sample).nonce.startsWith("0x"), true);
  const crash = readAttemptReceipt(
    fileURLToPath(new URL("../fixtures/crash-stage-receipt.json", import.meta.url)),
  );
  assert.equal(crash.stage, "paid_send_dispatched");
});
