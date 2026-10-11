// Disposable loopback receipt for lost-reply and killed-receipt recovery.
// No live payment, signing, or external message. Writes one JSON object.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { opportunityPreflight } from "../../../opportunity-preflight.mjs";
import { transactionReceipt } from "../../../transaction-receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outPath = process.argv[2];
if (!outPath) throw new Error("receipt_path_required");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const payer = `0x${"2".repeat(40)}`;
const preflightArgs = {
  rewardUsd: 10, hours: 1, hourlyCostUsd: 1, selectionProbabilityPct: 80,
  agentAccess: "agent_allowed", acceptance: "deterministic", settlement: "direct",
};
const receiptArgs = { transactionHash: `0x${"2".repeat(64)}`, network: "base" };
const checkedAt = () => new Date("2026-10-11T00:00:00.000Z");
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

function fixtureClient({ delayMs = 0 } = {}) {
  return {
    async getTransactionReceipt() {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { status: "success", blockNumber: 50n, gasUsed: 21000n, effectiveGasPrice: 1n, logs: [] };
    },
    async getBlock() {
      throw new Error("fixture_missing_block_timestamp");
    },
  };
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function scenario(name) {
  const directory = await mkdtemp(path.join(tmpdir(), "native-recovery-211210-"));
  const dataDir = path.join(directory, "merchant");
  const counts = { verify: 0, settle: 0, markerBeforeSettlement: false };
  const facilitator = createServer(async (req, res) => {
    let output;
    if (req.url === "/supported") output = { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} };
    else if (req.url === "/verify") { counts.verify += 1; output = { isValid: true, payer }; }
    else if (req.url === "/settle") {
      counts.settle += 1;
      const journal = JSON.parse(await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8"));
      counts.markerBeforeSettlement = journal.records.some((record) => record.pending && record.settlementAttempted);
      output = { success: true, network: "eip155:8453", payer, transaction: `0x${counts.settle.toString(16).padStart(64, "0")}` };
    } else { res.writeHead(404); res.end(); return; }
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(output));
  });
  const facilitatorPort = await listen(facilitator);
  let target;
  let child;
  const proxyState = { loseNextPaidResponse: false, lost: 0, calls: [] };
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const message = raw.length ? JSON.parse(raw.toString()) : null;
      if (message?.method === "tools/call") proxyState.calls.push(message.params.name);
      const response = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        ...(raw.length ? { body: raw } : {}),
        redirect: "error",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (proxyState.loseNextPaidResponse && message?.method === "tools/call"
        && message.params.name !== "recover_paid_result" && message.params._meta?.["x402/payment"]) {
        proxyState.loseNextPaidResponse = false;
        proxyState.lost += 1;
        res.destroy();
        return;
      }
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
      res.end(bytes);
    } catch { res.destroy(); }
  });
  const proxyPort = await listen(proxy);
  const endpointUrl = `http://127.0.0.1:${proxyPort}/mcp`;
  async function start(extra = {}) {
    await stop(child);
    const probe = createServer();
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    target = `http://127.0.0.1:${port}`;
    const configFile = path.join(directory, "receiver.json");
    await writeFile(configFile, JSON.stringify({
      dataDir, port, endpointUrl, tenantId: "tenant-a",
      facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`, ...extra,
    }));
    child = spawn(process.execPath, ["docs/reviews/native-task-recovery-211200/loopback-service.mjs", configFile], {
      cwd: root, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`receiver_timeout ${output.slice(-500)}`)), 20000);
      const data = (part) => {
        output += part;
        if (output.includes('"ready":true')) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on("data", data);
      child.stderr.on("data", data);
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`receiver_exited ${output.slice(-500)}`)); });
    });
  }
  async function operation(toolName, inputArgs) {
    const client = new Client({ name: "cold-receipt", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpointUrl)));
    const catalog = await client.listTools();
    const accepted = catalog.tools.find((tool) => tool.name === toolName)._meta.x402.accepts[0];
    await client.close();
    const suffix = randomBytes(8).toString("hex");
    const payment = {
      x402Version: 2,
      resource: { url: `mcp://tool/${toolName}` },
      accepted,
      payload: {
        signature: `0x${"4".repeat(130)}`,
        authorization: {
          from: payer, to: accepted.payTo, value: accepted.amount, validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${randomBytes(32).toString("hex")}`,
        },
      },
      extensions: { "payment-identifier": { info: { required: false, id: `recovery_${suffix}` } } },
    };
    const input = {
      endpointUrl, tenantId: "tenant-a", principalId: "principal-a", name: toolName, arguments: inputArgs, payment,
      maxAtomic: accepted.amount, operationId: `operation-${suffix}`, reservationId: `reservation-${suffix}`, grantId: `grant-${suffix}`,
    };
    const grant = {
      ...Object.fromEntries(["endpointUrl", "tenantId", "principalId", "name", "maxAtomic", "operationId", "reservationId", "grantId"].map((key) => [key, input[key]])),
      inputDigest: hash(inputArgs), termsDigest: hash(accepted), paymentDigest: hash(payment),
      expiresAt: new Date(Date.now() + 300_000).toISOString(), execute: true, readResult: true, revoked: false,
    };
    const inputFile = path.join(directory, `input-${suffix}.json`);
    const checkpoint = path.join(directory, `checkpoint-${suffix}.json`);
    const grantFile = path.join(directory, `grant-${suffix}.json`);
    await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
    await writeFile(grantFile, JSON.stringify(grant), { mode: 0o600 });
    return { input, grant, inputFile, checkpoint, grantFile };
  }
  async function cli(action, op, { interruptOnReceipt = false } = {}) {
    const argv = action === "start" ? [action, op.inputFile, op.checkpoint, op.grantFile] : [action, op.checkpoint, op.grantFile];
    const processChild = spawn(process.execPath, ["caller-result-client/bin/recover-mcp.mjs", ...argv], {
      cwd: root, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    processChild.stdout.on("data", (chunk) => { stdout += chunk; });
    processChild.stderr.on("data", (chunk) => { stderr += chunk; });
    const finished = new Promise((resolve) => {
      const timer = setTimeout(() => processChild.kill("SIGKILL"), 20000);
      processChild.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    if (interruptOnReceipt) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const executing = await fetch(`${target}/fixture-counts`).then((response) => response.json());
        if (executing.receipt > 0) { processChild.kill("SIGKILL"); break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const finishedResult = await finished;
    assert.equal(stdout.includes("0x4444"), false);
    return { ...finishedResult, stderr, pid: processChild.pid, body: stdout.trim() ? JSON.parse(stdout) : null };
  }
  async function journal() {
    return JSON.parse(await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8"));
  }
  try {
    return await name({ start, operation, cli, journal, counts, proxyState, directory });
  } finally {
    await stop(child);
    proxy.closeAllConnections();
    facilitator.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => facilitator.close(resolve)),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
}

const opportunity = await scenario(async (f) => {
  await f.start();
  const op = await f.operation("opportunity_preflight", preflightArgs);
  f.proxyState.loseNextPaidResponse = true;
  const first = await f.cli("start", op);
  assert.equal(first.code, 2, first.stderr);
  assert.equal(first.body.state, "unresolved");
  assert.equal(f.counts.settle, 1);
  assert.equal(f.counts.markerBeforeSettlement, true);
  await f.start();
  const cold = await f.cli("resume", op);
  assert.equal(cold.code, 0, cold.stderr);
  const direct = opportunityPreflight(preflightArgs);
  assert.deepEqual(cold.body.output, direct);
  await writeFile(op.grantFile, JSON.stringify({ ...op.grant, maxAtomic: "999999" }));
  const widened = await f.cli("resume", op);
  assert.equal(widened.code, 2);
  assert.match(widened.stderr, /grant_/);
  assert.equal(f.counts.settle, 1);
  assert.equal(f.counts.verify, 1);
  assert.deepEqual(f.proxyState.calls, ["opportunity_preflight", "recover_paid_result"]);
  return {
    seam: "lost_reply_provider_restart",
    state: cold.body.state,
    decision: cold.body.output.decision,
    expectedSurplusUsd: cold.body.output.economics.expectedSurplusUsd,
    directEqual: true,
    verify: f.counts.verify,
    settle: f.counts.settle,
    calls: f.proxyState.calls,
    newPaymentPermitted: cold.body.budget.newPaymentPermitted,
    usefulness: cold.body.budget.usefulness,
    widenedBudgetRefused: true,
    paidLiveCalls: 0,
  };
});

const receipt = await scenario(async (f) => {
  await f.start({ receiptDelayMs: 750 });
  const op = await f.operation("transaction_receipt", receiptArgs);
  const first = await f.cli("start", op, { interruptOnReceipt: true });
  assert.equal(first.code, null);
  assert.equal(first.signal, "SIGKILL");
  assert.equal(first.body, null);
  assert.equal(JSON.parse(await readFile(op.checkpoint, "utf8")).state, "pending");
  const deadline = Date.now() + 5000;
  while ((await f.journal()).records[0]?.kind !== "mcp" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal((await f.journal()).records[0].kind, "mcp");
  assert.equal(f.counts.markerBeforeSettlement, true);
  const killedPid = first.pid;
  await f.start();
  const cold = await f.cli("resume", op);
  assert.equal(cold.code, 0, cold.stderr);
  assert.notEqual(cold.pid, killedPid);
  const direct = await transactionReceipt(receiptArgs, { now: checkedAt, client: fixtureClient() });
  assert.deepEqual(cold.body.output, direct);
  assert.equal(f.counts.settle, 1);
  assert.equal(f.counts.verify, 1);
  assert.deepEqual(f.proxyState.calls, ["transaction_receipt", "recover_paid_result"]);
  return {
    seam: "kill_during_receipt_provider_restart",
    state: cold.body.state,
    decision: cold.body.output.decision,
    blockTimestamp: cold.body.output.transaction.blockTimestamp,
    finding: cold.body.output.findings[0].code,
    directEqual: true,
    directRoute: "transactionReceipt",
    verify: f.counts.verify,
    settle: f.counts.settle,
    calls: f.proxyState.calls,
    newPaymentPermitted: cold.body.budget.newPaymentPermitted,
    remoteStopped: cold.body.budget.remoteStopped,
    refunded: cold.body.budget.refunded,
    usefulness: cold.body.budget.usefulness,
    paidLiveCalls: 0,
  };
});

const document = {
  synthetic: true,
  paidLiveCalls: 0,
  ownerQaIsNotCustomerOrRevenue: true,
  opportunity,
  receipt,
};
await writeFile(outPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ wrote: outPath, opportunity: opportunity.decision, receipt: receipt.decision })}\n`);
