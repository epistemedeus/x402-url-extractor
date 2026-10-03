import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";

import { digestOf } from "./task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs";
import { NETWORKS } from "./transaction-receipt.mjs";
import { containsAccount } from "./useful-result-reuse/base-receipt.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const TOKEN = "customer-retention-internal-token-32bytes-min";
const SENTINEL = "sentinel-private-reuse-100245";
const TASK = "receipt-task-1";
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const FOUND = `0x${"ab".repeat(32)}`;
const MISSING = `0x${"cd".repeat(32)}`;
const DOWN = `0x${"ef".repeat(32)}`;
const EXPIRING = `0x${"12".repeat(32)}`;
const LEFT = `0x${"34".repeat(32)}`;
const RIGHT = `0x${"56".repeat(32)}`;
const BLOCK_HASH = `0x${"2".repeat(64)}`;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const TOPICS = encodeEventTopics({ abi: [TRANSFER], eventName: "Transfer", args: { from: FROM, to: TO } });
const DATA = encodeAbiParameters([{ type: "uint256" }], [5_000n]);
const LOGS_BLOOM = `0x${"0".repeat(512)}`;

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.once("error", reject);
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function startRpc() {
  const state = { missing: new Set([MISSING]), fail: new Set(), unknown: [] };
  const server = createHttpServer(async (req, res) => {
    const body = await readJsonBody(req);
    const calls = Array.isArray(body) ? body : [body];
    const replies = calls.map((call) => {
      const id = call?.id ?? null;
      const method = call?.method;
      const fail = (message) => ({ jsonrpc: "2.0", id, error: { code: -32000, message } });
      const ok = (result) => ({ jsonrpc: "2.0", id, result });
      if (method === "eth_chainId") return ok("0x2105");
      if (method === "eth_getBlockByNumber") {
        return ok({
          baseFeePerGas: hex(100),
          difficulty: "0x0",
          extraData: "0x",
          gasLimit: hex(30_000_000),
          gasUsed: hex(21_000),
          hash: BLOCK_HASH,
          logsBloom: LOGS_BLOOM,
          miner: "0x0000000000000000000000000000000000000000",
          mixHash: `0x${"8".repeat(64)}`,
          nonce: "0x0000000000000000",
          number: hex(50),
          parentHash: `0x${"3".repeat(64)}`,
          receiptsRoot: `0x${"6".repeat(64)}`,
          sha3Uncles: `0x${"7".repeat(64)}`,
          size: hex(100),
          stateRoot: `0x${"5".repeat(64)}`,
          timestamp: hex(1_786_350_903),
          totalDifficulty: "0x0",
          transactions: [],
          transactionsRoot: `0x${"4".repeat(64)}`,
          uncles: [],
        });
      }
      if (method === "eth_getTransactionReceipt") {
        const hash = String(call?.params?.[0] || "").toLowerCase();
        if (state.fail.has(hash)) return fail("rpc down");
        if (state.missing.has(hash)) return ok(null);
        return ok({
          blockHash: BLOCK_HASH,
          blockNumber: hex(50),
          contractAddress: null,
          cumulativeGasUsed: hex(21_000),
          effectiveGasPrice: hex(2_000_000_000),
          from: FROM,
          gasUsed: hex(21_000),
          l1Fee: hex(1),
          l1FeeScalar: "1",
          l1GasPrice: hex(1),
          l1GasUsed: hex(1),
          logs: [{
            address: NETWORKS.base.canonicalUsdc,
            blockHash: BLOCK_HASH,
            blockNumber: hex(50),
            data: DATA,
            logIndex: "0x7",
            removed: false,
            topics: TOPICS,
            transactionHash: hash,
            transactionIndex: "0x3",
          }],
          logsBloom: LOGS_BLOOM,
          status: "0x1",
          to: TO,
          transactionHash: hash,
          transactionIndex: "0x3",
          type: "0x2",
        });
      }
      state.unknown.push(method);
      return fail("method_not_found");
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  });
  return { server, state };
}

function startFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const state = { settle: "ok" };
  const server = createHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ isValid: true, payer: PAYER }));
      return;
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      await readJsonBody(req);
      res.writeHead(state.settle === "unknown" ? 500 : 200, { "content-type": "application/json" });
      if (state.settle === "garbage") {
        res.end("not-json");
        return;
      }
      if (state.settle === "fail") {
        res.end(JSON.stringify({
          errorReason: "settlement_failed",
          network: NETWORK,
          payer: PAYER,
          success: false,
          transaction: `0x${"9".repeat(64)}`,
        }));
        return;
      }
      if (state.settle === "unknown") {
        res.end(JSON.stringify({ error: "settlement_unknown" }));
        return;
      }
      res.end(JSON.stringify({
        network: NETWORK,
        payer: PAYER,
        success: true,
        transaction: `0x${"3".repeat(64)}`,
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unexpected_test_facilitator_request" }));
  });
  return { calls, server, state };
}

async function startMerchant({ dataDir, facilitatorUrl, rpcUrl, logs }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_INTERNAL_TOKEN: TOKEN,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PORT: String(port),
      PUBLIC_URL: "https://agents.samedaydesk.com",
      TRANSACTION_RECEIPT_BASE_RPC_URLS: rpcUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const onData = (chunk) => {
    output = `${output}${chunk}`.slice(-80_000);
    logs.push(String(chunk));
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const ready = (chunk) => {
      if (!String(chunk).includes(`x402-merchant listening on :${port}`) && !output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", ready);
    child.stderr.on("data", ready);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "receipt challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "receipt challenge omitted Base exact terms");
  return Buffer.from(JSON.stringify({
    accepted,
    extensions: {
      "payment-identifier": {
        info: { id: `receipt_${randomBytes(8).toString("hex")}`, required: challenge.extensions?.["payment-identifier"]?.info?.required === true },
      },
    },
    payload: {
      authorization: {
        from: PAYER,
        nonce: `0x${randomBytes(32).toString("hex")}`,
        to: accepted.payTo,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        value: accepted.amount,
      },
      signature: `0x${"4".repeat(130)}`,
    },
    x402Version: 2,
  })).toString("base64");
}

function receiptUrl(base, hash) {
  return `${base}/chain/transaction-receipt?transactionHash=${hash}&network=base`;
}

async function challengeFor(base, hash, headers = {}) {
  const unpaid = await fetch(receiptUrl(base, hash), { headers });
  assert.equal(unpaid.status, 402, await unpaid.text());
  return { challenge: decodePaymentRequired(unpaid), unpaid };
}

function cold(env) {
  return spawnSync(process.execPath, ["useful-result-reuse/grant-caller.mjs"], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

function coldJson(env) {
  const result = cold(env);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.includes(env.USEFUL_RESULT_GRANT || "missing-grant"), false);
  assert.equal(result.stdout.includes(SENTINEL), false);
  assert.equal(result.stdout.includes(TOKEN), false);
  return JSON.parse(result.stdout);
}

function customerLines(dataDir) {
  return readFile(path.join(dataDir, "useful-result-customer.ndjson"), "utf8")
    .then((text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)))
    .catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
}

test("a second HTTP client retrieves a retained receipt with only the returned grant", { timeout: 240_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "customer-http-"));
  const logs = [];
  const rpc = startRpc();
  const facilitator = startFacilitator();
  const rpcUrl = await listen(rpc.server);
  const facilitatorUrl = await listen(facilitator.server);
  let merchant;
  const grants = [];
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await closeServer(facilitator.server);
    await closeServer(rpc.server);
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl, logs, rpcUrl });

  const plain = await challengeFor(merchant.base, FOUND);
  const opted = await challengeFor(merchant.base, FOUND, {
    "user-agent": SENTINEL,
    "x-samedaydesk-retain-result": "1",
  });
  assert.equal(opted.unpaid.headers.get("x-samedaydesk-result-grant"), null);
  assert.equal(plain.challenge.accepts.find((entry) => entry.scheme === "exact").amount, opted.challenge.accepts.find((entry) => entry.scheme === "exact").amount);
  assert.equal(opted.challenge.accepts.find((entry) => entry.scheme === "exact").payTo, PAY_TO);
  assert.equal(new URL(plain.challenge.resource.url).pathname, "/chain/transaction-receipt");
  assert.equal(plain.challenge.resource.description, opted.challenge.resource.description);
  assert.deepEqual(await customerLines(dataDir), []);

  const malformed = await fetch(`${merchant.base}/chain/transaction-receipt?transactionHash=0x12&network=base`, {
    headers: { "payment-signature": "not-a-payment", "x-samedaydesk-retain-result": "1" },
  });
  assert.equal(malformed.status, 400);
  assert.equal(facilitator.calls.settle, 0);
  assert.deepEqual(await customerLines(dataDir), []);

  async function pay(hash, { retain = true, payment = null, until = null } = {}) {
    const { challenge } = await challengeFor(merchant.base, hash);
    const signature = payment || testPayment(challenge);
    const headers = {
      "payment-signature": signature,
      "user-agent": SENTINEL,
    };
    if (retain) {
      headers["x-samedaydesk-outcome-task"] = TASK;
      headers["x-samedaydesk-retain-result"] = "1";
      if (until) headers["x-samedaydesk-retain-until"] = until;
    }
    const response = await fetch(receiptUrl(merchant.base, hash), { headers });
    const body = await response.json();
    return { body, response, signature };
  }

  facilitator.state.settle = "fail";
  const failed = await pay(FOUND);
  assert.equal(failed.response.status, 402, JSON.stringify(failed.body));
  assert.equal(failed.response.headers.get("x-samedaydesk-result-grant"), null);
  assert.equal(facilitator.calls.settle, 1);
  assert.deepEqual(await customerLines(dataDir), []);

  facilitator.state.settle = "garbage";
  const garbage = await pay(FOUND);
  assert.equal(garbage.response.status, 502, JSON.stringify(garbage.body));
  assert.equal(garbage.response.headers.get("x-samedaydesk-result-grant"), null);
  assert.equal(garbage.response.headers.get("payment-response"), null);
  assert.deepEqual(await customerLines(dataDir), []);
  facilitator.state.settle = "unknown";
  const unknown = await pay(FOUND);
  assert.equal(unknown.response.status, 402, JSON.stringify(unknown.body));
  assert.equal(unknown.response.headers.get("x-samedaydesk-result-grant"), null);
  facilitator.state.settle = "ok";
  assert.deepEqual(await customerLines(dataDir), []);

  const missing = await pay(MISSING);
  assert.equal(missing.response.status, 200, JSON.stringify(missing.body));
  assert.equal(missing.body.decision, "not_found");
  assert.equal(missing.body.product, "samedaydesk-transaction-receipt");
  assert.equal(Object.hasOwn(missing.body, "paidValidDelivery"), false);
  const missingGrant = missing.response.headers.get("x-samedaydesk-result-grant");
  assert.match(missingGrant, /^[0-9a-f]{64}$/);
  grants.push(missingGrant);
  const missingRead = coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: missingGrant });
  assert.equal(missingRead.status, 200);
  assert.equal(missingRead.decision, "not_found");
  assert.equal(missingRead.paidValidDelivery, false);
  assert.equal(missingRead.paymentPermitted, false);
  assert.equal(missingRead.resultDigest, digestOf(missing.body));

  rpc.state.fail.add(DOWN);
  const down = await pay(DOWN);
  assert.equal(down.response.status, 200, JSON.stringify(down.body));
  assert.equal(down.body.decision, "rpc_unavailable");
  assert.equal(down.response.headers.get("x-samedaydesk-retain-result"), "execution_failed");
  assert.equal(down.response.headers.get("x-samedaydesk-result-grant"), null);
  rpc.state.fail.delete(DOWN);
  assert.equal((await customerLines(dataDir)).some((row) => row.body?.request?.transactionHash === DOWN), false);

  const paid = await pay(FOUND);
  assert.equal(paid.response.status, 200, `${JSON.stringify(paid.body)}\n${merchant.output().slice(-2000)}`);
  assert.equal(paid.body.decision, "found");
  assert.equal(paid.body.transaction.transactionFeeWei, "42000000000000");
  assert.equal(paid.body.transaction.blockNumber, "50");
  assert.equal(paid.body.receipt.canonicalUsdcTransferCount, 1);
  assert.equal(paid.body.transaction.from.toLowerCase(), FROM);
  assert.equal(Object.hasOwn(paid.body, "grant"), false);
  assert.equal(paid.response.headers.get("x-samedaydesk-retain-result"), "retained");
  const grant = paid.response.headers.get("x-samedaydesk-result-grant");
  const resultId = paid.response.headers.get("x-samedaydesk-result-id");
  assert.match(grant, /^[0-9a-f]{64}$/);
  grants.push(grant);
  assert.equal(digestOf(paid.body), (coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: grant,
  })).resultDigest);

  const settleBeforeReplay = facilitator.calls.settle;
  const replay = await pay(FOUND, { payment: paid.signature });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.response.headers.get("x-payment-replay"), "hit");
  assert.equal(replay.response.headers.get("x-samedaydesk-result-grant"), null);
  assert.equal(digestOf(replay.body), digestOf(paid.body));
  assert.equal(facilitator.calls.settle, settleBeforeReplay);

  const second = await pay(FOUND);
  const secondGrant = second.response.headers.get("x-samedaydesk-result-grant");
  assert.match(secondGrant, /^[0-9a-f]{64}$/);
  assert.notEqual(secondGrant, grant);
  grants.push(secondGrant);
  assert.equal(facilitator.calls.settle, settleBeforeReplay + 1);
  assert.equal(coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: grant }).decision, "found");
  assert.equal(coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: secondGrant }).decision, "found");

  const verifyBeforeAttack = facilitator.calls.verify;
  const extractAttack = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://example.com/")}`, {
    headers: { "payment-signature": grant },
  });
  assert.equal(extractAttack.status, 402);
  const receiptAttack = await fetch(receiptUrl(merchant.base, FOUND), {
    headers: { "payment-signature": grant, "x-samedaydesk-retain-result": "1" },
  });
  assert.equal(receiptAttack.status, 402);
  assert.equal(receiptAttack.headers.get("x-samedaydesk-result-grant"), null);
  assert.equal(facilitator.calls.verify, verifyBeforeAttack);

  const wrongResult = coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: grant,
    USEFUL_RESULT_RESULT_ID: "deadbeef",
  });
  assert.equal(wrongResult.status, 403);
  assert.equal(wrongResult.error, "wrong_result");
  assert.equal(wrongResult.hasResult, false);
  const wrongMethod = coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_BOUND_METHOD: "POST",
    USEFUL_RESULT_BASE_DUP: merchant.base,
    USEFUL_RESULT_GRANT: grant,
  });
  assert.equal(wrongMethod.error, "wrong_method");
  assert.equal(coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_BOUND_RESOURCE: "/extract",
    USEFUL_RESULT_GRANT: grant,
  }).error, "wrong_resource");
  assert.equal(coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: grant,
    USEFUL_RESULT_QUERY: `grant=${grant}`,
  }).error, "credential_in_url");
  assert.equal(coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: grant,
    USEFUL_RESULT_METHOD: "PUT",
  }).error, "method_rejected");
  assert.equal(coldJson({
    USEFUL_RESULT_ACTION: "revoke",
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: grant,
    USEFUL_RESULT_METHOD: "GET",
  }).error, "action_rejected");
  assert.equal(coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: grant,
    USEFUL_RESULT_OMIT_GRANT: "1",
  }).error, "grant_required");
  assert.equal(coldJson({
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: "ab".repeat(32),
  }).error, "grant_rejected");

  const sharedResponse = await fetch(`${merchant.base}/.well-known/useful-result-reuse/retained`, {
    headers: { "x-samedaydesk-result-action": "share-knowledge", "x-samedaydesk-result-grant": grant },
    method: "POST",
  });
  const shared = await sharedResponse.json();
  assert.equal(sharedResponse.status, 200, JSON.stringify(shared));
  assert.equal(shared.accepted, true);
  assert.equal(containsAccount(shared.share), false);
  assert.equal(JSON.stringify(shared.share).includes(SENTINEL), false);
  assert.equal(JSON.stringify(shared.share).includes(TASK), false);
  assert.equal(JSON.stringify(shared.share).includes(grant), false);
  const currentResponse = await fetch(`${merchant.base}/.well-known/useful-result-reuse/current.json`);
  const current = await currentResponse.json();
  assert.equal(current.schema, "samedaydesk.useful-result-reuse.current.v1");
  assert.equal(current.hostedReuseVerified, false);
  assert.equal(current.customerRetentionHostedVerified, false);
  assert.equal(current.productionHosted, false);
  assert.equal(current.historicalRevenue, "unknown");
  assert.equal(current.recognizedRevenueAtomic, "0");
  assert.equal(current.customerRetention.internalTokenRequired, false);
  assert.equal(current.customerRetention.credentialInUrl, false);
  assert.equal(current.customerRetention.read.route, "/.well-known/useful-result-reuse/retained");
  assert.equal(current.compatibility.length, 1);
  assert.equal(current.knowledge.length, 0);
  assert.equal(containsAccount(current), false);
  assert.equal(JSON.stringify(current).includes(SENTINEL), false);
  assert.equal(JSON.stringify(current).includes(grant), false);
  assert.equal(JSON.stringify(current).includes(TOKEN), false);
  assert.equal(JSON.stringify(current).includes(FROM.slice(2)), false);

  const work = await mkdtemp(path.join(tmpdir(), "customer-consumer-"));
  t.after(async () => rm(work, { recursive: true, force: true }));
  const derivativeFile = path.join(work, "derivative.json");
  const captureFile = path.join(work, "receipt.json");
  const driftedFile = path.join(work, "drifted.json");
  await writeFile(derivativeFile, JSON.stringify(current.compatibility[0]));
  const capture = {
    blockHash: BLOCK_HASH,
    blockTimestamp: "1786350903",
    receipt: {
      blockHash: BLOCK_HASH,
      blockNumber: "50",
      effectiveGasPrice: "2000000000",
      from: FROM,
      gasUsed: "21000",
      logs: [{ address: NETWORKS.base.canonicalUsdc, data: DATA, logIndex: "7", topics: TOPICS }],
      status: "success",
      to: TO,
      transactionIndex: "3",
    },
    schema: "samedaydesk.public-historical-base-receipt.v1",
    transactionHash: FOUND,
  };
  await writeFile(captureFile, JSON.stringify(capture));
  await writeFile(driftedFile, JSON.stringify({
    ...capture,
    receipt: { ...capture.receipt, gasUsed: "1" },
  }));
  const consumed = spawnSync(process.execPath, ["useful-result-reuse/compatibility-consumer.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      USEFUL_RESULT_BASE: merchant.base,
      USEFUL_RESULT_DERIVATIVE: derivativeFile,
      USEFUL_RESULT_DIRECT_RECEIPT: captureFile,
      USEFUL_RESULT_RECEIPT: captureFile,
    },
  });
  assert.equal(consumed.status, 0, `${consumed.stdout}\n${consumed.stderr}\nunknown rpc ${rpc.state.unknown.join(",")}`);
  const consumedBody = JSON.parse(consumed.stdout);
  assert.equal(consumedBody.sameUsefulOutput, true, consumed.stdout);
  assert.equal(consumedBody.reason, "independently_replayed");
  assert.equal(consumedBody.laterDecision, "found");
  assert.equal(consumedBody.directDecision, "found");
  assert.equal(consumedBody.laterFee, paid.body.transaction.transactionFeeWei);
  assert.equal(consumedBody.directFee, consumedBody.laterFee);
  assert.equal(consumedBody.executionSaved, false);
  assert.equal(consumedBody.observedSaving, false);
  assert.equal(consumedBody.usefulTransferred, false);
  assert.equal(consumedBody.paymentPermitted, false);
  assert.equal(consumedBody.recognizedRevenueAtomic, "0");
  assert.equal(consumedBody.historicalRevenue, "unknown");
  assert.equal(consumedBody.revenueRecognized, false);
  assert.equal(consumedBody.laterReceiptCalls, 1);
  assert.equal(consumedBody.directReceiptCalls, 1);
  assert.equal(consumed.stdout.includes(grant), false);
  assert.equal(consumed.stdout.includes(FROM.slice(2)), false);

  const drifted = spawnSync(process.execPath, ["useful-result-reuse/compatibility-consumer.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      USEFUL_RESULT_BASE: merchant.base,
      USEFUL_RESULT_DERIVATIVE: derivativeFile,
      USEFUL_RESULT_RECEIPT: driftedFile,
    },
  });
  assert.equal(drifted.status, 0, drifted.stderr);
  assert.equal(JSON.parse(drifted.stdout).reason, "source_changed");
  assert.equal(JSON.parse(drifted.stdout).executionSaved, false);

  const corrected = await fetch(`${merchant.base}/.well-known/useful-result-reuse/retained`, {
    headers: { "x-samedaydesk-result-action": "correct-knowledge", "x-samedaydesk-result-grant": grant },
    method: "POST",
  });
  assert.equal(corrected.status, 200, await corrected.text());
  const correctedConsumer = spawnSync(process.execPath, ["useful-result-reuse/compatibility-consumer.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      USEFUL_RESULT_BASE: merchant.base,
      USEFUL_RESULT_DERIVATIVE: derivativeFile,
      USEFUL_RESULT_RECEIPT: captureFile,
    },
  });
  assert.equal(correctedConsumer.status, 0, correctedConsumer.stderr);
  const correctedBody = JSON.parse(correctedConsumer.stdout);
  assert.equal(correctedBody.reason, "corrected");
  assert.equal(correctedBody.laterReceiptCalls, 0);
  assert.equal(correctedBody.paymentPermitted, false);
  const afterCorrection = await fetch(`${merchant.base}/.well-known/useful-result-reuse/current.json`).then((response) => response.json());
  assert.equal(afterCorrection.compatibility.length, 0);
  assert.equal(afterCorrection.compatibilityCorrections.some((item) => item.corrects === shared.share.shareId), true);
  assert.equal(JSON.stringify(afterCorrection).includes(SENTINEL), false);

  const readBeforeRestart = coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: secondGrant });
  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl, logs, rpcUrl });
  const readAfterRestart = coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: secondGrant });
  assert.equal(readAfterRestart.status, 200);
  assert.equal(readAfterRestart.resultDigest, readBeforeRestart.resultDigest);
  assert.equal(readAfterRestart.decision, "found");
  assert.equal(readAfterRestart.transactionFeeWei, "42000000000000");

  const lines = await customerLines(dataDir);
  const identity = readBeforeRestart.requestIdentity;
  const tampered = lines.map((row) => row.requestIdentity === identity && row.action === "retain"
    ? { ...row, body: { ...row.body, decision: "tampered" } }
    : row);
  await writeFile(path.join(dataDir, "useful-result-customer.ndjson"), `${tampered.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const corrupt = coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: secondGrant });
  assert.equal(corrupt.status, 409);
  assert.equal(corrupt.error, "record_integrity");
  assert.equal(corrupt.hasResult, false);

  const revoked = coldJson({
    USEFUL_RESULT_ACTION: "revoke",
    USEFUL_RESULT_BASE: merchant.base,
    USEFUL_RESULT_GRANT: grant,
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked));
  assert.equal(revoked.reason, "revoked");
  const afterRevoke = coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: grant });
  assert.equal(afterRevoke.status, 403);
  assert.equal(afterRevoke.error, "revoked");
  assert.equal(afterRevoke.hasResult, false);

  const until = new Date(Date.now() + 4_000).toISOString();
  const expiring = await pay(EXPIRING, { until });
  const expiringGrant = expiring.response.headers.get("x-samedaydesk-result-grant");
  assert.match(expiringGrant, /^[0-9a-f]{64}$/);
  grants.push(expiringGrant);
  assert.equal(coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: expiringGrant }).decision, "found");
  await new Promise((resolve) => setTimeout(resolve, 4_500));
  const expired = coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: expiringGrant });
  assert.equal(expired.status, 403);
  assert.equal(expired.error, "expired");
  assert.equal(expired.hasResult, false);

  const [left, right] = await Promise.all([pay(LEFT), pay(RIGHT)]);
  assert.equal(left.response.status, 200, JSON.stringify(left.body));
  assert.equal(right.response.status, 200, JSON.stringify(right.body));
  const leftGrant = left.response.headers.get("x-samedaydesk-result-grant");
  const rightGrant = right.response.headers.get("x-samedaydesk-result-grant");
  grants.push(leftGrant, rightGrant);
  const [leftRead, rightRead] = await Promise.all([
    Promise.resolve(coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: leftGrant })),
    Promise.resolve(coldJson({ USEFUL_RESULT_BASE: merchant.base, USEFUL_RESULT_GRANT: rightGrant })),
  ]);
  assert.equal(leftRead.resultDigest, digestOf(left.body));
  assert.equal(rightRead.resultDigest, digestOf(right.body));
  assert.notEqual(leftRead.requestIdentity, rightRead.requestIdentity);

  const html = await fetch(merchant.base, { headers: { accept: "text/html" } }).then((response) => response.text());
  assert.match(html, /Agent infrastructure humans can/);
  assert.equal(html.includes("usefulResultRetention"), false);
  assert.equal(html.includes("/.well-known/useful-result-reuse/retained"), false);
  assert.equal(html.includes(SENTINEL), false);
  const gateway = await fetch(merchant.base, { headers: { accept: "application/json" } }).then((response) => response.json());
  assert.equal(gateway.machineCommerce.usefulResultRetention.read, "/.well-known/useful-result-reuse/retained");
  assert.equal(gateway.machineCommerce.usefulResultRetention.credentialInUrl, false);
  assert.equal(gateway.machineCommerce.usefulResultRetention.internalTokenRequired, false);
  assert.equal(gateway.machineCommerce.usefulResultRetention.price, "free");
  const mcp = await fetch(`${merchant.base}/mcp`).then((response) => response.json());
  assert.equal(mcp.usefulResultGrant, "https://agents.samedaydesk.com/.well-known/useful-result-reuse/retained");
  assert.equal(mcp.toolCount, 22);
  const openapi = await fetch(`${merchant.base}/openapi.json`).then((response) => response.json());
  assert.equal(openapi.paths["/.well-known/useful-result-reuse/retained"].get.operationId, "readRetainedUsefulResult");
  assert.equal(openapi.paths["/.well-known/useful-result-reuse/retained"].post.operationId, "mutateRetainedUsefulResult");
  assert.equal(openapi.paths["/.well-known/useful-result-reuse/current.json"].get.operationId, "getUsefulResultReuseCurrent");
  assert.equal(openapi.paths["/chain/transaction-receipt"].get.operationId, "getTransactionReceipt");
  assert.ok(openapi.paths["/chain/transaction-receipt"].get["x-payment-info"]);

  const stored = await readFile(path.join(dataDir, "useful-result-customer.ndjson"), "utf8");
  const retainedAttempts = stored.trim().split("\n").map(JSON.parse).filter(row => row.action === "retain");
  const commerceAttempts = (await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
  for (const row of retainedAttempts) {
    assert.match(row.commerceEventId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(commerceAttempts.find(event => event.id === row.commerceEventId)?.result, "paid_success");
  }
  const replayFile = await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8");
  const metricFile = await readFile(path.join(dataDir, "useful-result-metrics.ndjson"), "utf8");
  const sharedFile = await readFile(path.join(dataDir, "useful-result-shared.ndjson"), "utf8");
  const taskFile = await readFile(path.join(dataDir, "commerce-outcome-task-ref.ndjson"), "utf8");
  const logText = logs.join("");
  for (const secret of [grant, secondGrant, missingGrant, expiringGrant, leftGrant, rightGrant, TOKEN, SENTINEL, TASK]) {
    assert.equal(logText.includes(secret), false, secret);
    assert.equal(replayFile.includes(secret), false, secret);
    assert.equal(metricFile.includes(secret), false, secret);
    assert.equal(sharedFile.includes(secret), false, secret);
    assert.equal(taskFile.includes(secret), false, secret);
    if (secret !== TASK) assert.equal(stored.includes(secret), false, secret);
  }
  assert.equal(stored.includes(TASK), false);
  assert.equal((await stat(path.join(dataDir, "useful-result-customer.ndjson"))).mode & 0o777, 0o600);
  assert.equal(metricFile.includes("\"kind\":\"verified_settlement\""), false);
  assert.equal(metricFile.includes("\"kind\":\"paid_settlement\""), false);
  assert.equal(metricFile.includes("\"kind\":\"valid_delivery\""), false);
  assert.equal(metricFile.includes("\"kind\":\"paid_valid_delivery\""), true);
  assert.equal(metricFile.includes("\"kind\":\"retention_opt_in\""), true);
  assert.equal(metricFile.includes("\"kind\":\"retained_result\""), true);
  assert.equal(metricFile.includes("\"kind\":\"useful_later_read\""), true);
  assert.equal(metricFile.includes("\"kind\":\"correction\""), true);
  assert.equal(await access(path.join(dataDir, "useful-result-customer.ndjson")).then(() => true), true);
  assert.equal(resultId.length > 16, true);
});
