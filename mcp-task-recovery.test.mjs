import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { opportunityPreflight } from "./opportunity-preflight.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const payer = `0x${"2".repeat(40)}`;
const args = { rewardUsd: 10, hours: 1, hourlyCostUsd: 1, selectionProbabilityPct: 80,
  agentAccess: "agent_allowed", acceptance: "deterministic", settlement: "direct" };
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => { const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); }); });
}
async function fixture(t, { unknown = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "native-mcp-recovery-"));
  const dataDir = path.join(directory, "merchant");
  const counts = { verify: 0, settle: 0, markerBeforeSettlement: false };
  const facilitator = createServer(async (req, res) => {
    let output;
    if (req.url === "/supported") output = { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} };
    else if (req.url === "/verify") { counts.verify++; output = { isValid: true, payer }; }
    else if (req.url === "/settle") {
      counts.settle++;
      const journal = JSON.parse(await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8"));
      counts.markerBeforeSettlement = journal.records.some(record => record.pending && record.settlementAttempted);
      output = unknown ? { success: false, errorReason: "unknown_settlement", network: "eip155:8453", transaction: "" }
        : { success: true, network: "eip155:8453", payer, transaction: `0x${counts.settle.toString(16).padStart(64, "0")}` };
    } else { res.writeHead(404); res.end(); return; }
    req.resume(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(output));
  });
  const facilitatorPort = await listen(facilitator);
  let target;
  let child;
  const proxyState = { loseNextPaidResponse: false, lost: 0, calls: [], requests: 0 };
  const proxy = createServer(async (req, res) => {
    try {
      proxyState.requests++;
      const chunks = []; for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const message = raw.length ? JSON.parse(raw.toString()) : null;
      if (message?.method === "tools/call") proxyState.calls.push(message.params.name);
      const response = await fetch(`${target}${req.url}`, { method: req.method,
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        ...(raw.length ? { body: raw } : {}), redirect: "error" });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (proxyState.loseNextPaidResponse && message?.method === "tools/call"
        && message.params.name !== "recover_paid_result" && message.params._meta?.["x402/payment"]) {
        proxyState.loseNextPaidResponse = false; proxyState.lost++; res.destroy(); return;
      }
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" }); res.end(bytes);
    } catch { res.destroy(); }
  });
  const proxyPort = await listen(proxy);
  const endpointUrl = `http://127.0.0.1:${proxyPort}/mcp`;
  async function start(extra = {}) {
    await stop(child);
    const probe = createServer(); const port = await listen(probe); await new Promise(resolve => probe.close(resolve));
    target = `http://127.0.0.1:${port}`;
    const configFile = path.join(directory, "receiver.json");
    await writeFile(configFile, JSON.stringify({ dataDir, port, endpointUrl, tenantId: "tenant-a",
      facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`, ...extra }));
    child = spawn(process.execPath, ["docs/reviews/native-task-recovery-211200/loopback-service.mjs", configFile], {
      cwd: root, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`receiver_timeout ${output.slice(-2000)}`)), 20000);
      const data = part => { output += part; if (output.includes('"ready":true')) { clearTimeout(timer); resolve(); } };
      child.stdout.on("data", data); child.stderr.on("data", data);
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`receiver_exited ${output.slice(-2000)}`)); });
    });
    return child.pid;
  }
  async function open() {
    const client = new Client({ name: "cold-recovery-receiver", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpointUrl)));
    return client;
  }
  async function operation(name = "opportunity_preflight", inputArgs = args) {
    const client = await open();
    const catalog = await client.listTools();
    assert.equal(client.getServerCapabilities().tasks, undefined);
    const accepted = catalog.tools.find(tool => tool.name === name)._meta.x402.accepts[0];
    await client.close();
    const suffix = randomBytes(8).toString("hex");
    const payment = { x402Version: 2, resource: { url: `mcp://tool/${name}` }, accepted,
      payload: { signature: `0x${"4".repeat(130)}`, authorization: { from: payer, to: accepted.payTo,
        value: accepted.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${randomBytes(32).toString("hex")}` } },
      extensions: { "payment-identifier": { info: { required: false, id: `recovery_${suffix}` } } } };
    const input = { endpointUrl, tenantId: "tenant-a", principalId: "principal-a", name, arguments: inputArgs, payment,
      maxAtomic: accepted.amount, operationId: `operation-${suffix}`, reservationId: `reservation-${suffix}`, grantId: `grant-${suffix}` };
    const grant = { ...Object.fromEntries(["endpointUrl", "tenantId", "principalId", "name", "maxAtomic", "operationId", "reservationId", "grantId"].map(key => [key, input[key]])),
      inputDigest: hash(inputArgs), termsDigest: hash(accepted), paymentDigest: hash(payment),
      expiresAt: new Date(Date.now() + 300_000).toISOString(), execute: true, readResult: true, revoked: false };
    const inputFile = path.join(directory, `input-${suffix}.json`), checkpoint = path.join(directory, `checkpoint-${suffix}.json`), grantFile = path.join(directory, `grant-${suffix}.json`);
    await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 }); await writeFile(grantFile, JSON.stringify(grant), { mode: 0o600 });
    return { input, grant, inputFile, checkpoint, grantFile };
  }
  async function cli(action, op, { interruptOnReceipt = false } = {}) {
    const argv = action === "start" ? [action, op.inputFile, op.checkpoint, op.grantFile] : [action, op.checkpoint, op.grantFile];
    const processChild = spawn(process.execPath, ["caller-result-client/bin/recover-mcp.mjs", ...argv], {
      cwd: root, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    processChild.stdout.on("data", chunk => { stdout += chunk; }); processChild.stderr.on("data", chunk => { stderr += chunk; });
    const finished = new Promise(resolve => { const timer = setTimeout(() => processChild.kill("SIGKILL"), 20000);
      processChild.once("exit", code => { clearTimeout(timer); resolve(code); }); });
    if (interruptOnReceipt) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const executing = await fetch(`${target}/fixture-counts`).then(response => response.json());
        if (executing.receipt > 0) { processChild.kill("SIGKILL"); break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    const code = await finished;
    assert.equal(stdout.includes(op.input.payment.payload.signature), false);
    assert.equal(stdout.includes(op.input.payment.payload.authorization.nonce), false);
    return { code, stderr, pid: processChild.pid, body: stdout.trim() ? JSON.parse(stdout) : null };
  }
  t.after(async () => { await stop(child); proxy.closeAllConnections(); facilitator.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => facilitator.close(resolve))]);
    await rm(directory, { recursive: true, force: true }); });
  await start();
  return { counts, proxyState, endpointUrl, directory, dataDir, start, open, operation, cli,
    stopProvider: () => stop(child),
    journal: async () => JSON.parse(await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8")),
    handlerCounts: async () => (await fetch(`${target}/fixture-counts`)).json() };
}

test("ordinary cold CLI retrieves the same whole outcome after lost response and provider/client process restart", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const op = await f.operation();
  f.proxyState.loseNextPaidResponse = true;
  const first = await f.cli("start", op);
  assert.equal(first.code, 2, first.stderr); assert.equal(first.body.state, "unresolved");
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.markerBeforeSettlement, true);
  assert.equal((await f.handlerCounts()).opportunity, 1);
  const stored = (await f.journal()).records[0];
  assert.equal(stored.kind, "mcp"); assert.equal(stored.pending, undefined);
  await f.start();
  const cold = await f.cli("resume", op);
  assert.equal(cold.code, 0, cold.stderr); assert.equal(cold.body.state, "completed");
  assert.notEqual(first.pid, cold.pid);
  assert.deepEqual(cold.body.output, opportunityPreflight(args));
  assert.equal(cold.body.output.decision, "attempt"); assert.equal(cold.body.output.economics.expectedSurplusUsd, 7);
  assert.equal(cold.body.budget.reportedSettledAtomic, "50000"); assert.equal(cold.body.budget.newPaymentPermitted, false);
  assert.equal(cold.body.budget.usefulness, "unknown");
  assert.deepEqual(f.proxyState.calls, ["opportunity_preflight", "recover_paid_result"]);
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.verify, 1);
  assert.deepEqual(await f.handlerCounts(), { opportunity: 0, receipt: 0 });
  t.diagnostic(JSON.stringify({ coldRecovery: true, synthetic: true, settle: 1, usefulAcceptance: "unknown", paidLiveCalls: 0 }));
});

test("a completed ordinary cold client consumes its local output when the provider is unavailable", { timeout: 60000 }, async t => {
  const f = await fixture(t), op = await f.operation();
  const delivered = await f.cli("start", op);
  assert.equal(delivered.code, 0, delivered.stderr);
  await f.stopProvider();
  const requests = f.proxyState.requests;
  const cold = await f.cli("resume", op);
  assert.equal(cold.code, 0, cold.stderr); assert.notEqual(cold.pid, delivered.pid);
  assert.deepEqual(cold.body.output, delivered.body.output);
  assert.deepEqual(f.proxyState.calls, ["opportunity_preflight"]);
  assert.equal(f.proxyState.requests, requests);
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.verify, 1);
});

test("an ordinary process interrupted during the current asynchronous receipt task resumes its retained partial output", { timeout: 60000 }, async t => {
  const f = await fixture(t); await f.start({ receiptDelayMs: 750 });
  const op = await f.operation("transaction_receipt", { transactionHash: `0x${"2".repeat(64)}`, network: "base" });
  const first = await f.cli("start", op, { interruptOnReceipt: true });
  assert.equal(first.code, null); assert.equal(first.body, null);
  assert.equal(JSON.parse(await readFile(op.checkpoint, "utf8")).state, "pending");
  const deadline = Date.now() + 5000;
  while ((await f.journal()).records[0]?.kind !== "mcp" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal((await f.journal()).records[0].kind, "mcp");
  assert.equal(f.counts.markerBeforeSettlement, true);
  await f.start();
  const cold = await f.cli("resume", op);
  assert.equal(cold.code, 0, cold.stderr); assert.notEqual(cold.pid, first.pid);
  assert.equal(cold.body.output.decision, "found");
  assert.equal(cold.body.output.transaction.blockTimestamp, null);
  assert.equal(cold.body.output.findings[0].code, "block_timestamp_unavailable");
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.verify, 1);
  assert.deepEqual(f.proxyState.calls, ["transaction_receipt", "recover_paid_result"]);
});

test("cold recovery consumes current useful refusal, valid empty and partial results without a paid retry", { timeout: 90000 }, async t => {
  const f = await fixture(t);
  for (const [name, input, expected] of [
    ["opportunity_preflight", { ...args, agentAccess: "human_only" }, "abandon"],
    ["opportunity_preflight", { ...args, selectionProbabilityPct: undefined }, "verify_first"],
    ["transaction_receipt", { transactionHash: `0x${"1".repeat(64)}`, network: "base" }, "not_found"],
    ["transaction_receipt", { transactionHash: `0x${"2".repeat(64)}`, network: "base" }, "found"],
  ]) {
    const op = await f.operation(name, input); f.proxyState.loseNextPaidResponse = true;
    assert.equal((await f.cli("start", op)).body.state, "unresolved");
    await f.start();
    const result = await f.cli("resume", op);
    assert.equal(result.code, 0, result.stderr); assert.equal(result.body.output.decision, expected);
    if (expected === "not_found") assert.deepEqual(result.body.output.transfers, []);
    if (expected === "found") {
      assert.equal(result.body.output.transaction.blockTimestamp, null);
      assert.equal(result.body.output.findings[0].code, "block_timestamp_unavailable");
    }
    if (expected === "verify_first") assert.ok(result.body.output.gates.requiredChecks.length);
  }
  assert.equal(f.counts.settle, 4); assert.equal(f.counts.verify, 4); assert.equal(f.proxyState.lost, 4);
});

test("wrong tenant/endpoint/input/quote/recipient/credential refuse at the actual lookup with no new effects", { timeout: 60000 }, async t => {
  const f = await fixture(t); const op = await f.operation();
  f.proxyState.loseNextPaidResponse = true; await f.cli("start", op);
  const client = await f.open(); t.after(() => client.close());
  async function read(payment, input = op.input.arguments) {
    const result = await client.callTool({ name: "recover_paid_result", arguments: { name: op.input.name, arguments: input },
      _meta: { "x402/payment": payment, "samedaydesk/recovery-call":
        Object.fromEntries(["operationId", "reservationId", "principalId", "grantId"].map(key => [key, op.input[key]])) } });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error, "payment_identifier_request_conflict");
  }
  await read(op.input.payment, { ...args, rewardUsd: 20 });
  for (const key of ["amount", "payTo", "signature"]) {
    const payment = structuredClone(op.input.payment);
    if (key === "signature") payment.payload.signature = `0x${"6".repeat(130)}`;
    else payment.accepted[key] = key === "amount" ? "60000" : `0x${"c".repeat(40)}`;
    await read(payment);
  }
  const replacement = structuredClone(op.input.payment);
  replacement.payload.authorization.nonce = `0x${"7".repeat(64)}`;
  replacement.payload.signature = `0x${"8".repeat(130)}`;
  replacement.extensions["payment-identifier"].info.id = "replacement_paid_credential_211200";
  const duplicate = await client.callTool({ name: op.input.name, arguments: op.input.arguments,
    _meta: { "x402/payment": replacement, "samedaydesk/recovery-call":
      Object.fromEntries(["operationId", "reservationId", "principalId", "grantId"].map(key => [key, op.input[key]])) } });
  assert.equal(duplicate.isError, true);
  assert.equal(JSON.parse(duplicate.content[0].text).error, "payment_identifier_request_conflict");
  await f.start({ tenantId: "tenant-b" }); await read(op.input.payment);
  const rejectedTenant = await f.cli("resume", op);
  assert.equal(rejectedTenant.body.state, "unresolved");
  assert.equal(rejectedTenant.body.failure, "recovery_endpoint_or_tenant_rejected");
  await f.start({ endpointUrl: "https://other.example/mcp" }); await read(op.input.payment);
  assert.equal((await f.cli("resume", op)).body.failure, "recovery_endpoint_or_tenant_rejected");
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.verify, 1);
});

test("provider quote changes preserve retrieval of the original purchase without adopting new terms", { timeout: 60000 }, async t => {
  const f = await fixture(t); const op = await f.operation();
  f.proxyState.loseNextPaidResponse = true; await f.cli("start", op);
  await f.start({ price: "$0.06" });
  const cold = await f.cli("resume", op);
  assert.equal(cold.code, 0, cold.stderr);
  assert.deepEqual(cold.body.output, opportunityPreflight(args));
  assert.equal(cold.body.budget.reservedAtomic, "50000");
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.verify, 1);
  assert.deepEqual(f.proxyState.calls, ["opportunity_preflight", "recover_paid_result"]);
});

test("unknown payment survives restart and reconciliation reads never create another paid request", { timeout: 60000 }, async t => {
  const f = await fixture(t, { unknown: true }); const op = await f.operation();
  const first = await f.cli("start", op);
  assert.equal(first.body.state, "unresolved");
  assert.equal((await f.journal()).records[0].settlementAttempted, true);
  await f.start();
  const cold = await f.cli("resume", op);
  assert.equal(cold.body.state, "unresolved"); assert.equal(cold.body.budget.possibleAtomic, "50000");
  assert.equal(cold.body.budget.newPaymentPermitted, false);
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.verify, 1);
  assert.deepEqual(f.proxyState.calls, ["opportunity_preflight", "recover_paid_result"]);
});

test("revoked/expired grants and widened budgets refuse in a fresh ordinary process before lookup", { timeout: 60000 }, async t => {
  const f = await fixture(t); const op = await f.operation();
  f.proxyState.loseNextPaidResponse = true; await f.cli("start", op);
  const requests = f.proxyState.requests;
  for (const patch of [{ revoked: true }, { expiresAt: "2000-01-01T00:00:00.000Z" }, { maxAtomic: "999999" }]) {
    await writeFile(op.grantFile, JSON.stringify({ ...op.grant, ...patch }));
    const result = await f.cli("resume", op);
    assert.equal(result.code, 2); assert.match(result.stderr, /grant_/);
  }
  assert.deepEqual(f.proxyState.calls, ["opportunity_preflight"]);
  assert.equal(f.proxyState.requests, requests);
  assert.equal(f.counts.settle, 1); assert.equal(f.counts.verify, 1);
});
