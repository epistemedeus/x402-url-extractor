import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";

import { NETWORKS } from "../../../../transaction-receipt.mjs";
import { BUNDLE_SCHEMA, OBSERVATION_SCHEMA } from "../src/constants.mjs";
import { evaluateBundle, toPublic } from "../src/evaluate.mjs";
import { readMerchantRecords } from "../src/project-merchant.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const PAYER = `0x${"2".repeat(40)}`;
const NETWORK = "eip155:8453";
const TOKEN = "useful-economics-internal-token-32b-min";
const SENTINEL = "sentinel-useful-economics-100290";
const TASK = "receipt-task-100290";
const FOREIGN_EVENT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const FOUND = `0x${"ab".repeat(32)}`;
const MISSING = `0x${"cd".repeat(32)}`;
const DOWN = `0x${"ef".repeat(32)}`;
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
  const state = { missing: new Set([MISSING]), fail: new Set([DOWN]) };
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
      return fail("method_not_found");
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  });
  return { server, state };
}

function startFacilitator() {
  const calls = { settle: 0, verify: 0 };
  const state = { settle: "ok" };
  const server = createHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
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
        res.end(JSON.stringify({ errorReason: "settlement_failed", network: NETWORK, payer: PAYER, success: false, transaction: `0x${"9".repeat(64)}` }));
        return;
      }
      if (state.settle === "unknown") {
        res.end(JSON.stringify({ error: "settlement_unknown" }));
        return;
      }
      res.end(JSON.stringify({ network: NETWORK, payer: PAYER, success: true, transaction: `0x${"3".repeat(64)}` }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unexpected_test_facilitator_request" }));
  });
  return { calls, server, state };
}

async function startMerchant({ dataDir, facilitatorUrl, rpcUrl }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: repo,
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

function caller(base, grant, action) {
  return spawnSync(process.execPath, ["useful-result-reuse/grant-caller.mjs"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      USEFUL_RESULT_BASE: base,
      USEFUL_RESULT_GRANT: grant,
      ...(action ? { USEFUL_RESULT_ACTION: action } : {}),
    },
  });
}

function qaFromLive(name, response, body) {
  const decision = body && typeof body.decision === "string" ? body.decision : null;
  const retain = response.headers.get("x-samedaydesk-retain-result");
  const grant = response.headers.get("x-samedaydesk-result-grant");
  const executionFailed = decision === "rpc_unavailable" || retain === "execution_failed";
  return {
    schema: OBSERVATION_SCHEMA,
    eventId: name,
    operationId: "normalized-transaction-receipt",
    stage: executionFailed ? "verified_delivery" : response.status === 402 && !response.headers.get("payment-response") && grant == null && response.status === 402 ? "attempted_call" : "settlement",
    sourceClass: "owner_qa",
    authority: "server_execution",
    cohort: "owner_qa",
    httpStatus: response.status,
    serverExecution: executionFailed ? "failed" : "absent",
    paymentPresented: response.headers.get("payment-response") != null || name.startsWith("qa-presented"),
    settlementStatus: response.status >= 500 || response.status === 402 ? "unknown" : "absent",
    settlementTrusted: false,
    explicitCriterionMet: false,
    reasons: executionFailed ? ["execution_failed"] : [],
  };
}

test("disposable merchant execution joins retained, failed, and later records", { timeout: 180_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "useful-economics-merchant-"));
  const rpc = startRpc();
  const facilitator = startFacilitator();
  const rpcUrl = await listen(rpc.server);
  const facilitatorUrl = await listen(facilitator.server);
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await closeServer(facilitator.server);
    await closeServer(rpc.server);
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl, rpcUrl });
  const live = [];

  const unpaid = await fetch(receiptUrl(merchant.base, FOUND));
  assert.equal(unpaid.status, 402);
  const unpaidBody = await unpaid.json();
  assert.equal(unpaid.headers.get("x-samedaydesk-result-grant"), null);
  live.push({ ...qaFromLive("qa-unpaid-challenge", unpaid, unpaidBody), paymentPresented: false, stage: "attempted_call", settlementStatus: "absent" });

  async function pay(hash) {
    const challengeResponse = await fetch(receiptUrl(merchant.base, hash));
    assert.equal(challengeResponse.status, 402);
    const challenge = decodePaymentRequired(challengeResponse);
    await challengeResponse.json();
    const response = await fetch(receiptUrl(merchant.base, hash), {
      headers: {
        "payment-signature": testPayment(challenge),
        "user-agent": SENTINEL,
        "x-commerce-event-id": FOREIGN_EVENT,
        "x-samedaydesk-commerce-event-id": FOREIGN_EVENT,
        "x-samedaydesk-outcome-task": TASK,
        "x-samedaydesk-retain-result": "1",
      },
    });
    const body = await response.json().catch(() => null);
    return { body, response };
  }

  facilitator.state.settle = "fail";
  const failed = await pay(FOUND);
  assert.equal(failed.response.status, 402, JSON.stringify(failed.body));
  assert.equal(failed.response.headers.get("x-samedaydesk-result-grant"), null);
  live.push({ ...qaFromLive("qa-presented-settlement-fail", failed.response, failed.body), paymentPresented: true, stage: "settlement" });

  facilitator.state.settle = "unknown";
  const unknown = await pay(FOUND);
  assert.equal(unknown.response.status, 402, JSON.stringify(unknown.body));
  assert.equal(unknown.response.headers.get("x-samedaydesk-result-grant"), null);
  live.push({ ...qaFromLive("qa-presented-settlement-unknown", unknown.response, unknown.body), paymentPresented: true, stage: "settlement" });

  facilitator.state.settle = "garbage";
  const garbage = await pay(FOUND);
  assert.equal(garbage.response.status, 502, JSON.stringify(garbage.body));
  assert.equal(garbage.response.headers.get("x-samedaydesk-result-grant"), null);
  assert.equal(garbage.response.headers.get("payment-response"), null);
  live.push({ ...qaFromLive("qa-presented-settlement-garbage", garbage.response, garbage.body), paymentPresented: true, stage: "settlement", httpStatus: garbage.response.status, settlementStatus: "unknown" });

  facilitator.state.settle = "ok";
  const down = await pay(DOWN);
  assert.equal(down.response.status, 200, JSON.stringify(down.body));
  assert.equal(down.body.decision, "rpc_unavailable");
  assert.equal(down.response.headers.get("x-samedaydesk-retain-result"), "execution_failed");
  assert.equal(down.response.headers.get("x-samedaydesk-result-grant"), null);
  live.push({ ...qaFromLive("qa-presented-execution-failed", down.response, down.body), paymentPresented: true });

  const missing = await pay(MISSING);
  assert.equal(missing.response.status, 200, JSON.stringify(missing.body));
  assert.equal(missing.body.decision, "not_found");
  assert.equal(missing.body.receipt.found, false);
  const missingGrant = missing.response.headers.get("x-samedaydesk-result-grant");
  assert.match(missingGrant, /^[0-9a-f]{64}$/);
  const missingRead = caller(merchant.base, missingGrant);
  assert.equal(missingRead.status, 0, missingRead.stderr);
  assert.equal(JSON.parse(missingRead.stdout).decision, "not_found");

  const found = await pay(FOUND);
  assert.equal(found.response.status, 200, `${JSON.stringify(found.body)}\n${merchant.output().slice(-1500)}`);
  assert.equal(found.body.decision, "found");
  const firstGrant = found.response.headers.get("x-samedaydesk-result-grant");
  assert.match(firstGrant, /^[0-9a-f]{64}$/);
  const second = await pay(FOUND);
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  const secondGrant = second.response.headers.get("x-samedaydesk-result-grant");
  assert.match(secondGrant, /^[0-9a-f]{64}$/);
  assert.notEqual(secondGrant, firstGrant);
  const secondRead = caller(merchant.base, secondGrant);
  assert.equal(JSON.parse(secondRead.stdout).decision, "found");

  const revoked = caller(merchant.base, firstGrant, "revoke");
  assert.equal(revoked.status, 0, `${revoked.stdout}\n${revoked.stderr}`);
  assert.equal(JSON.parse(revoked.stdout).reason, "revoked");
  const firstAfter = caller(merchant.base, firstGrant);
  assert.equal(JSON.parse(firstAfter.stdout).error, "revoked");
  const secondAfter = caller(merchant.base, secondGrant);
  assert.equal(JSON.parse(secondAfter.stdout).decision, "found");

  const extract = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://example.com/")}`);
  assert.equal(extract.status, 402);
  await extract.text();

  const projected = await readMerchantRecords(dataDir);
  const commerce = projected.records.filter((row) => row?.v === 3 && row.route === "/chain/transaction-receipt");
  const failureCodes = [...new Set(commerce.map((row) => row.paymentFailureCode).filter(Boolean))].sort();
  const receipt = await evaluateBundle({
    schema: BUNDLE_SCHEMA,
    coverage: "owner_qa",
    records: projected.records,
    observations: live,
    truncatedRecords: projected.truncated,
  });
  const published = toPublic(receipt);
  const text = JSON.stringify(published);
  for (const secret of [SENTINEL, TOKEN, missingGrant, firstGrant, secondGrant, FOUND, MISSING, DOWN, PAYER, FROM, TO]) {
    assert.equal(text.includes(secret), false, `public query exposed a disposable secret (${secret.slice(0, 8)})`);
  }
  const bound = published.journeys.find((journey) => journey.operationId === "normalized-transaction-receipt" && journey.taskRef);
  assert.ok(bound, JSON.stringify(published.journeys.map((journey) => [journey.operationId, journey.taskRef, journey.status])));
  assert.equal(bound.identicalBody, true);
  assert.equal(bound.revocationTransferred, false);
  assert.equal(bound.reused, true);
  assert.equal(bound.useful, "true");
  const slots = receipt.journeys.find((journey) => journey.taskRef === bound.taskRef && journey.operationId === "normalized-transaction-receipt").ownerSlots;
  assert.equal(slots.some((slot) => slot.serverExecution === "not_found" && slot.useful === "agreed_negative"), true);
  assert.equal(slots.filter((slot) => slot.paidValidDelivery).length, 1);
  assert.equal(slots.filter((slot) => slot.withdrawn).length, 1);
  const failedExecution = published.journeys.find((journey) => journey.reasons.includes("execution_failed"));
  assert.ok(failedExecution);
  assert.equal(failedExecution.useful, "false");
  assert.equal(failedExecution.settlementTrusted, false);
  const routeJourneys = published.journeys.filter((journey) => journey.operationId === "get:/chain/transaction-receipt");
  const boundRoute = routeJourneys.filter((journey) => journey.taskRef === bound.taskRef);
  const unboundRoute = routeJourneys.filter((journey) => journey.taskRef == null);
  assert.equal(boundRoute.length, 1);
  assert.equal(boundRoute[0].settlementTrusted, false);
  assert.equal(boundRoute[0].useful === "true" || boundRoute[0].useful === "agreed_negative", false);
  assert.equal(unboundRoute.length > 0, true);
  assert.equal(unboundRoute.every((journey) => journey.settlementTrusted === false), true);
  assert.equal(unboundRoute.every((journey) => journey.useful !== "true" && journey.useful !== "agreed_negative"), true);
  const taskRefs = projected.records.filter((row) => row?.schemaVersion === "samedaydesk.outcome-task-ref.v1");
  const boundEventIds = taskRefs.map((row) => row.commerceEventId).sort();
  const paidSuccess = projected.records.filter((row) => row?.v === 3 && row.route === "/chain/transaction-receipt" && row.result === "paid_success");
  const unboundPaid = paidSuccess.filter((row) => !boundEventIds.includes(row.id));
  assert.equal(boundEventIds.length, 3);
  assert.equal(unboundPaid.length, 1);
  assert.equal(unboundPaid[0].status, 200);
  assert.equal(boundEventIds.includes(FOREIGN_EVENT), false);
  assert.equal(paidSuccess.some((row) => row.id === FOREIGN_EVENT), false);
  const customerJourney = receipt.journeys.find((journey) => journey.taskRef === bound.taskRef && journey.operationId === "normalized-transaction-receipt");
  const paidJourney = receipt.journeys.find((journey) => journey.taskRef === bound.taskRef && journey.operationId === "get:/chain/transaction-receipt");
  assert.deepEqual([...customerJourney.commerceEventIds].sort(), boundEventIds);
  assert.deepEqual([...paidJourney.commerceEventIds].sort(), boundEventIds);
  assert.equal(customerJourney.commerceEventIds.includes(unboundPaid[0].id), false);
  assert.equal(paidJourney.useful === "true" || paidJourney.useful === "agreed_negative", false);
  assert.equal(paidJourney.settlementTrusted, false);
  const storedText = JSON.stringify(projected.records);
  assert.equal(storedText.includes(FOREIGN_EVENT), false);
  assert.equal(/[0-9a-f-]{36}\.[0-9a-f]{64}/.test(storedText), false);
  const extractJourney = published.journeys.find((journey) => journey.operationId === "get:/extract");
  assert.ok(extractJourney);
  assert.equal(extractJourney.taskRef, null);
  assert.notEqual(extractJourney.operationId, bound.operationId);
  assert.equal(published.economics.recognizedRevenueAtomic, "0");
  assert.equal(published.economics.historicalBankedRevenueUsdc, 10.955);
  assert.equal(published.economics.historicalCountedInBreakeven, false);
  assert.equal(published.economics.breakeven.calculable, false);
  assert.equal(published.economics.profit, null);
  assert.equal(published.query.useful.rate, null);
  assert.equal(published.demandEstablished, false);
  assert.equal(published.globalTrafficEstablished, false);
  assert.equal(published.gaps.includes("commerce_event_not_task_bound"), true);
  assert.equal(published.gaps.includes("causal_binding_conflict"), false);
  assert.equal(published.gaps.includes("effort_ledger_not_in_checkout"), true);
  const taskPath = path.join(dataDir, "commerce-outcome-task-ref.ndjson");
  const eventPath = path.join(dataDir, "commerce-events.ndjson");
  const taskBefore = await readFile(taskPath, "utf8");
  const eventsBefore = await readFile(eventPath, "utf8");
  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl, rpcUrl });
  assert.equal(await readFile(taskPath, "utf8"), taskBefore);
  assert.equal(await readFile(eventPath, "utf8"), eventsBefore);
  const replayedRecords = await readMerchantRecords(dataDir);
  const replayed = await evaluateBundle({
    schema: BUNDLE_SCHEMA,
    coverage: "owner_qa",
    records: replayedRecords.records,
    observations: live,
    truncatedRecords: replayedRecords.truncated,
  });
  const replayedCustomer = replayed.journeys.find((journey) => journey.taskRef === bound.taskRef && journey.operationId === "normalized-transaction-receipt");
  const replayedPaid = replayed.journeys.find((journey) => journey.taskRef === bound.taskRef && journey.operationId === "get:/chain/transaction-receipt");
  assert.equal(replayedCustomer.useful, "true");
  assert.equal(replayedCustomer.ownerSlots.some((slot) => slot.serverExecution === "not_found" && slot.useful === "agreed_negative"), true);
  assert.equal(replayedCustomer.ownerSlots.filter((slot) => slot.paidValidDelivery).length, 1);
  assert.deepEqual([...replayedPaid.commerceEventIds].sort(), boundEventIds);
  assert.equal(replayedPaid.useful === "true" || replayedPaid.useful === "agreed_negative", false);
  assert.equal(replayed.economics.recognizedRevenueAtomic, "0");
  assert.equal(published.meters.tokenMeter, "unknown");
  const customer = JSON.parse(await readFile(path.join(dataDir, "useful-result-customer.ndjson"), "utf8").then((value) => value.trim().split("\n").filter(Boolean).at(-1)));
  assert.equal(customer.schema, "samedaydesk.useful-result-reuse.customer-grant.v1");
  console.log(`USEFUL_ECONOMICS_MERCHANT ${JSON.stringify({
    calls: published.query.attempted.count,
    eligible: published.query.eligible.count,
    settled: published.query.settled.count,
    useful: published.query.useful.count,
    reused: published.query.reused.count,
    population: published.query.eligible.denominator,
    runtimeMs: published.meters.runtimeMs,
    tokenMeter: published.meters.tokenMeter,
    failureCodes,
    files: projected.files,
    gaps: published.gaps,
    boundUseful: bound.useful,
    agreedNegative: slots.some((slot) => slot.useful === "agreed_negative"),
    boundEventIds,
    paidUseful: paidJourney.useful,
    identicalBody: bound.identicalBody,
    revocationTransferred: bound.revocationTransferred,
  })}`);
  assert.equal(createHash("sha256").update(TOKEN).digest("hex").length, 64);
});
