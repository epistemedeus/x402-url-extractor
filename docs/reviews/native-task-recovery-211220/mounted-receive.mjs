// Real server.js after the shared mount. Loopback facilitator only.
// Settle counts are facilitator attempts, not observed chain transfers.
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
import { issueMcpCallerResultFeedbackToken } from "../../../caller-result-feedback.mjs";
import { mcpRecoveryBudget, mcpRecoveryFileStore, resumePaidMcpResult, startPaidMcpResult } from "../../../caller-result-client/src/mcp-recovery.mjs";
import { digestMcpCallId, digestMcpPayload } from "../../../http-delivery-evidence/digest.mjs";
import { MCP_MORPHO_RESOURCE, MCP_MORPHO_TOOL } from "../../../http-delivery-evidence/mcp-delivery.mjs";
import { createDeliveryObservation } from "../../../http-delivery-evidence/observation.mjs";
import { opportunityPreflight } from "../../../opportunity-preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outPath = process.argv[2];
if (!outPath) throw new Error("receipt_path_required");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const payer = `0x${"2".repeat(40)}`;
const preflightArgs = {
  rewardUsd: 10, hours: 1, hourlyCostUsd: 1, selectionProbabilityPct: 80,
  agentAccess: "agent_allowed", acceptance: "deterministic", settlement: "direct",
};
const listen = (server) => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

function morphoObservation() {
  const payload = Buffer.from('{"ok":true,"positionCount":1}', "utf8");
  const callId = "7";
  return createDeliveryObservation({
    source: "mcp_tool_result",
    responseDigest: digestMcpPayload(payload),
    responseByteLength: payload.length,
    tool: MCP_MORPHO_TOOL,
    productSku: "samedaydesk-morpho-position",
    resource: MCP_MORPHO_RESOURCE,
    issuedOfferDigest: "ab".repeat(32),
    callId,
    callDigest: digestMcpCallId(callId),
    settlementReference: `0x${"a".repeat(64)}`,
    applicationIsError: false,
    payload,
  });
}

async function stop(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function openWorld({ unknown = false, feedbackKey = "" } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "mounted-recovery-211220-"));
  const dataDir = path.join(directory, "merchant");
  const counts = { verify: 0, settle: 0 };
  const facilitator = createServer(async (req, res) => {
    let output;
    if (req.url === "/supported") {
      output = { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} };
    } else if (req.url === "/verify") {
      counts.verify += 1;
      output = { isValid: true, payer };
    } else if (req.url === "/settle") {
      counts.settle += 1;
      output = unknown
        ? { success: false, errorReason: "unknown_settlement", network: "eip155:8453", transaction: "" }
        : { success: true, payer, network: "eip155:8453", transaction: `0x${counts.settle.toString(16).padStart(64, "0")}` };
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(output));
  });
  const facilitatorPort = await listen(facilitator);
  const proxyState = { dropNextPaid: false, lost: 0, calls: [] };
  let target = null;
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const message = raw.length ? JSON.parse(raw.toString()) : null;
      if (message?.method === "tools/call") proxyState.calls.push(message.params?.name);
      const response = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: { accept: req.headers.accept || "application/json, text/event-stream", "content-type": "application/json" },
        ...(raw.length ? { body: raw } : {}),
        redirect: "error",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const paid = message?.method === "tools/call" && message.params?.name !== "recover_paid_result" && message.params?._meta?.["x402/payment"];
      if (proxyState.dropNextPaid && paid) {
        proxyState.dropNextPaid = false;
        proxyState.lost += 1;
        res.destroy();
        return;
      }
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
      res.end(bytes);
    } catch {
      res.destroy();
    }
  });
  const proxyPort = await listen(proxy);
  const publicOrigin = "https://agents.samedaydesk.com";
  const endpointUrl = `${publicOrigin}/mcp`;
  const dialUrl = `http://127.0.0.1:${proxyPort}/mcp`;
  let child = null;
  let paidLine = "";
  async function start() {
    await stop(child, "SIGTERM");
    const probe = createServer();
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    target = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PORT: String(port),
        PUBLIC_URL: publicOrigin,
        COMMERCE_DATA_DIR: dataDir,
        COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
        FACILITATOR: "xpay",
        FACILITATOR_URL: `http://127.0.0.1:${facilitatorPort}`,
        MPP_SECRET_KEY: "",
        EXTRACT_BATCH_ENABLED: "0",
        LOCKFILE_PIN_DELTA_ENABLED: "0",
        CALLER_RESULT_FEEDBACK_KEY: feedbackKey,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server_timeout ${output.slice(-1500)}`)), 30000);
      const onData = (chunk) => {
        output += chunk;
        if (output.includes("MCP server:  POST /mcp")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`server_exited ${output.slice(-1500)}`));
      });
    });
    const match = output.match(/MCP server:\s+POST \/mcp \((\d+) paid tools\)/);
    paidLine = match ? match[0] : "";
    return { pid: child.pid, paidCount: match ? Number(match[1]) : null };
  }
  async function kill() {
    const pid = child?.pid;
    await stop(child, "SIGKILL");
    assert.equal(child.signalCode, "SIGKILL");
    return pid;
  }
  async function journal() {
    return JSON.parse(await readFile(path.join(dataDir, "idempotency-replay.json"), "utf8"));
  }
  async function sdk() {
    const client = new Client({ name: "mounted-recovery-211220", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(dialUrl)));
    return client;
  }
  return {
    directory, dataDir, counts, proxyState, endpointUrl, dialUrl, paidLine: () => paidLine,
    start, kill, journal, sdk,
    async close() {
      await stop(child, "SIGKILL");
      proxy.closeAllConnections();
      facilitator.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => proxy.close(resolve)),
        new Promise((resolve) => facilitator.close(resolve)),
      ]);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function operation(world, name, inputArgs, tenantId = "public", endpointUrl = world.endpointUrl) {
  const client = await world.sdk();
  const catalog = await client.listTools();
  const tool = catalog.tools.find((entry) => entry.name === name);
  const accepted = tool._meta.x402.accepts[0];
  await client.close();
  const suffix = randomBytes(8).toString("hex");
  const payment = {
    x402Version: 2,
    resource: { url: `mcp://tool/${name}` },
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: payer, to: accepted.payTo, value: accepted.amount, validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${randomBytes(32).toString("hex")}`,
      },
    },
    extensions: { "payment-identifier": { info: { required: false, id: `mounted_${suffix}` } } },
  };
  const input = {
    endpointUrl, tenantId, principalId: "principal-a", name, arguments: inputArgs, payment,
    maxAtomic: accepted.amount, operationId: `operation-${suffix}`, reservationId: `reservation-${suffix}`, grantId: `grant-${suffix}`,
  };
  const grant = {
    ...Object.fromEntries(["endpointUrl", "tenantId", "principalId", "name", "maxAtomic", "operationId", "reservationId", "grantId"].map((key) => [key, input[key]])),
    inputDigest: hash(inputArgs), termsDigest: hash(accepted), paymentDigest: hash(payment),
    expiresAt: new Date(Date.now() + 300_000).toISOString(), execute: true, readResult: true, revoked: false,
  };
  const inputFile = path.join(world.directory, `input-${suffix}.json`);
  const checkpoint = path.join(world.directory, `checkpoint-${suffix}.json`);
  const grantFile = path.join(world.directory, `grant-${suffix}.json`);
  await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
  await writeFile(grantFile, JSON.stringify(grant), { mode: 0o600 });
  return { input, grant, inputFile, checkpoint, grantFile, catalogSize: catalog.tools.length, toolNames: catalog.tools.map((entry) => entry.name) };
}

async function cli(action, op) {
  const argv = action === "start" ? [action, op.inputFile, op.checkpoint, op.grantFile] : [action, op.checkpoint, op.grantFile];
  const processChild = spawn(process.execPath, ["caller-result-client/bin/recover-mcp.mjs", ...argv], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  processChild.stdout.on("data", (chunk) => { stdout += chunk; });
  processChild.stderr.on("data", (chunk) => { stderr += chunk; });
  const finished = await new Promise((resolve) => {
    const timer = setTimeout(() => processChild.kill("SIGKILL"), 30000);
    processChild.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.equal(stdout.includes(op.input.payment.payload.signature), false);
  return { ...finished, stderr, pid: processChild.pid, body: stdout.trim() ? JSON.parse(stdout) : null };
}

async function ordinary(world, action, op, { connect = true } = {}) {
  let sdkClient = null;
  try {
    const store = mcpRecoveryFileStore(op.checkpoint);
    const loadGrant = async () => JSON.parse(await readFile(op.grantFile, "utf8"));
    const client = connect ? await (async () => {
      sdkClient = await world.sdk();
      return {
        listTools: (...args) => sdkClient.listTools(...args),
        callTool: (...args) => sdkClient.callTool(...args),
        getToolOutputValidator: (...args) => sdkClient.getToolOutputValidator(...args),
        close: () => sdkClient.close(),
      };
    })() : { async close() {} };
    const handle = action === "start"
      ? await startPaidMcpResult({ client, store, input: op.input, loadGrant })
      : await resumePaidMcpResult({ client, store, loadGrant });
    const checkpoint = await handle.handoff();
    let output = checkpoint.result?.structuredContent ?? null;
    if (output === null && typeof checkpoint.result?.content?.[0]?.text === "string") {
      try { output = JSON.parse(checkpoint.result.content[0].text); } catch { output = null; }
    }
    const budget = mcpRecoveryBudget(checkpoint);
    return {
      code: checkpoint.state === "completed" ? 0 : 2,
      stderr: checkpoint.failure || "",
      body: { state: checkpoint.state, output, failure: checkpoint.failure ?? null, budget },
    };
  } catch (error) {
    await sdkClient?.close().catch(() => {});
    return { code: 2, stderr: `${error?.code || error?.message || "recovery_failed"}\n`, body: null };
  }
}

const feedbackKey = randomBytes(32).toString("hex");
const world = await openWorld({ feedbackKey });
const receipt = {};
try {
  const booted = await world.start();
  assert.equal(booted.paidCount, 23);
  const op = await operation(world, "opportunity_preflight", preflightArgs);
  assert.equal(op.catalogSize, 26);
  assert.equal(op.toolNames.filter((name) => name === "recover_paid_result").length, 1);
  const client = await world.sdk();
  const listed = await client.listTools();
  const recoveryTool = listed.tools.find((entry) => entry.name === "recover_paid_result");
  assert.equal(recoveryTool._meta.samedaydesk.paymentRequired, false);
  assert.equal(recoveryTool._meta.samedaydesk.charged, false);
  const paidNames = listed.tools.filter((entry) => entry._meta?.x402?.accepts).map((entry) => entry.name);
  assert.equal(paidNames.length, 23);
  assert.equal(paidNames.includes("recover_paid_result"), false);
  await client.close();

  const loopbackOp = await operation(world, "opportunity_preflight", preflightArgs, "public", world.dialUrl);
  const loopbackCli = await cli("start", loopbackOp);
  assert.equal(loopbackCli.code, 2, JSON.stringify({ stderr: loopbackCli.stderr, body: loopbackCli.body }));
  assert.match(`${loopbackCli.stderr}\n${loopbackCli.body?.failure || ""}`, /recovery_endpoint_or_tenant_rejected/);
  assert.equal(world.counts.settle, 0);
  assert.equal(world.counts.verify, 0);

  world.proxyState.dropNextPaid = true;
  const lost = await ordinary(world, "start", op);
  assert.equal(lost.code, 2, lost.stderr);
  assert.equal(lost.body.state, "unresolved");
  assert.equal(world.counts.verify, 1);
  assert.equal(world.counts.settle, 1);
  assert.equal(world.proxyState.lost, 1);
  const stored = (await world.journal()).records.find((record) => record.kind === "mcp");
  assert.ok(stored);
  assert.equal(stored.pending, undefined);
  const killedPid = await world.kill();
  const restarted = await world.start();
  assert.notEqual(restarted.pid, killedPid);
  const cold = await ordinary(world, "resume", op);
  assert.equal(cold.code, 0, cold.stderr);
  assert.equal(cold.body.state, "completed");
  const direct = opportunityPreflight(preflightArgs);
  assert.deepEqual(cold.body.output, direct);
  assert.equal(cold.body.output.decision, "attempt");
  assert.equal(cold.body.budget.newPaymentPermitted, false);
  assert.equal(cold.body.budget.usefulness, "unknown");
  assert.equal(world.counts.settle, 1);
  assert.equal(world.counts.verify, 1);
  assert.deepEqual(world.proxyState.calls.filter((name) => name === "opportunity_preflight" || name === "recover_paid_result"), ["opportunity_preflight", "recover_paid_result"]);

  const requestsBeforeLocal = world.proxyState.calls.length;
  await world.kill();
  const local = await ordinary(world, "resume", op, { connect: false });
  assert.equal(local.code, 0, local.stderr);
  assert.deepEqual(local.body.output, direct);
  assert.equal(world.proxyState.calls.length, requestsBeforeLocal);
  await world.start();

  for (const patch of [{ revoked: true }, { expiresAt: "2000-01-01T00:00:00.000Z" }, { maxAtomic: "999999" }]) {
    await writeFile(op.grantFile, JSON.stringify({ ...op.grant, ...patch }));
    const refused = await ordinary(world, "resume", op, { connect: false });
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /grant_/);
  }
  await writeFile(op.grantFile, JSON.stringify(op.grant));
  const wrongTenant = await operation(world, "opportunity_preflight", preflightArgs, "other-tenant");
  const tenantStart = await ordinary(world, "start", wrongTenant);
  assert.equal(tenantStart.code, 2);
  assert.match(tenantStart.stderr, /recovery_endpoint_or_tenant_rejected/);
  assert.equal(world.counts.settle, 1);

  const reader = await world.sdk();
  const replacement = structuredClone(op.input.payment);
  replacement.payload.authorization.nonce = `0x${"7".repeat(64)}`;
  replacement.payload.signature = `0x${"8".repeat(130)}`;
  replacement.extensions["payment-identifier"].info.id = "replacement_mounted_211220";
  const context = Object.fromEntries(["operationId", "reservationId", "principalId", "grantId"].map((key) => [key, op.input[key]]));
  const duplicate = await reader.callTool({
    name: "opportunity_preflight",
    arguments: op.input.arguments,
    _meta: { "x402/payment": replacement, "samedaydesk/recovery-call": context },
  });
  assert.equal(duplicate.isError, true);
  assert.equal(JSON.parse(duplicate.content[0].text).error, "payment_identifier_request_conflict");
  const changedInput = await reader.callTool({
    name: "recover_paid_result",
    arguments: { name: "opportunity_preflight", arguments: { ...preflightArgs, rewardUsd: 20 } },
    _meta: { "x402/payment": op.input.payment, "samedaydesk/recovery-call": context },
  });
  assert.equal(changedInput.isError, true);
  const replay = await reader.callTool({
    name: "opportunity_preflight",
    arguments: preflightArgs,
    _meta: { "x402/payment": op.input.payment, "samedaydesk/recovery-call": context },
  });
  assert.notEqual(replay.isError, true);
  const replayBody = replay.structuredContent ?? JSON.parse(replay.content[0].text);
  assert.equal(replayBody.decision, "attempt");
  assert.equal(world.counts.settle, 1);
  assert.equal(world.counts.verify, 1);

  const began = Date.now();
  const missing = await reader.callTool({
    name: "report_caller_result",
    arguments: {
      token: issueMcpCallerResultFeedbackToken({ key: feedbackKey, observation: morphoObservation(), now: Date.now() }),
      disposition: "useful",
      reasonCategory: "matched_task",
    },
  });
  const waited = Date.now() - began;
  assert.equal(missing.isError, true);
  assert.equal(JSON.parse(missing.content[0].text).code, "missing_capture");
  assert.equal(JSON.parse(missing.content[0].text).ok, false);
  assert.equal(waited >= 200, true);
  assert.equal(waited < 1500, true);
  const malformed = await reader.callTool({
    name: "report_caller_result",
    arguments: { token: `${"a".repeat(24)}.${"b".repeat(43)}`, disposition: "useful" },
  });
  assert.equal(malformed.isError, true);
  assert.equal(JSON.parse(malformed.content[0].text).ok, false);
  await reader.close();
  assert.equal(world.counts.settle, 1);

  receipt.mounted = {
    seam: "real_server_lost_reply_sigkill_restart",
    paidTools: 23,
    listedTools: 26,
    addedTool: "recover_paid_result",
    decision: cold.body.output.decision,
    expectedSurplusUsd: cold.body.output.economics.expectedSurplusUsd,
    directEqual: true,
    directRoute: "opportunityPreflight",
    verify: world.counts.verify,
    settle: world.counts.settle,
    chainTransfersObserved: 0,
    killedSignal: "SIGKILL",
    freeReadAfterRestart: true,
    localReadWithServerDown: true,
    widenedRevokedExpiredRefused: true,
    wrongTenantRefused: true,
    replacementNonceRefused: true,
    changedInputRefused: true,
    identicalReplaySettleCount: world.counts.settle,
    missingCaptureIsError: true,
    malformedCaptureIsError: true,
    newPaymentPermitted: false,
    paidLiveCalls: 0,
  };
} finally {
  await world.close();
}

const unknownWorld = await openWorld({ unknown: true, feedbackKey });
try {
  await unknownWorld.start();
  const op = await operation(unknownWorld, "opportunity_preflight", preflightArgs);
  const first = await ordinary(unknownWorld, "start", op);
  assert.equal(first.code, 2, first.stderr);
  assert.equal(first.body.state, "unresolved");
  assert.equal(unknownWorld.counts.settle, 1);
  assert.equal(unknownWorld.counts.verify, 1);
  const pending = (await unknownWorld.journal()).records[0];
  assert.equal(pending.settlementAttempted, true);
  assert.notEqual(pending.kind, "mcp");
  await unknownWorld.kill();
  await unknownWorld.start();
  const cold = await ordinary(unknownWorld, "resume", op);
  assert.equal(cold.code, 2);
  assert.equal(cold.body.state, "unresolved");
  assert.equal(cold.body.budget.newPaymentPermitted, false);
  assert.equal(cold.body.budget.possibleAtomic, op.input.payment.accepted.amount);
  assert.equal(cold.body.budget.remoteStopped, "unknown");
  assert.equal(cold.body.budget.refunded, "unknown");
  const client = await unknownWorld.sdk();
  const again = await client.callTool({
    name: "opportunity_preflight",
    arguments: preflightArgs,
    _meta: {
      "x402/payment": op.input.payment,
      "samedaydesk/recovery-call": Object.fromEntries(["operationId", "reservationId", "principalId", "grantId"].map((key) => [key, op.input[key]])),
    },
  });
  await client.close();
  assert.equal(again.isError, true);
  assert.equal(unknownWorld.counts.settle, 1);
  assert.equal(unknownWorld.counts.verify, 1);
  receipt.unknownSettlement = {
    state: "unresolved",
    settlementAttempted: true,
    verify: 1,
    settle: 1,
    secondSettlement: false,
    possibleAtomic: cold.body.budget.possibleAtomic,
    remoteStopped: "unknown",
    refunded: "unknown",
    chainTransfersObserved: 0,
  };
} finally {
  await unknownWorld.close();
}

const document = {
  synthetic: true,
  server: "server.js",
  paidLiveCalls: 0,
  chainTransfersObserved: 0,
  ownerQaIsNotCustomerOrRevenue: true,
  ...receipt,
};
await writeFile(outPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ wrote: outPath, decision: receipt.mounted.decision, settle: receipt.mounted.settle })}\n`);
