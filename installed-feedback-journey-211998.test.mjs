import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FIXTURE_ADDRESS } from "./experiments/morpho-useful-delivery-1005/fixture.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const installedRoot = path.resolve(process.env.SAMEDAYDESK_INSTALLED_SKILL_ROOT
  || "/tmp/hermes-user-211994/.hermes/skills/samedaydesk-task-result");
const script = path.join(installedRoot, "scripts/task-result.mjs");
const skipJourney = existsSync(script) ? false : `installed skill missing at ${script}`;
const PRODUCT = "0693da2a609df703f892eb4322d37910c3743b69";
const INSTALLED_FILES = {
  "SKILL.md": { bytes: 3696, sha256: "83fd65e53ffd93c45e7915afa0fd7e271ce226cb2a63e6d17e32b644bad66254" },
  "scripts/task-result.mjs": { bytes: 33653, sha256: "d1bc056d8a08d912c11803f69c5d85d82348801ed28494bc870d7c4c72b714c3" },
  "references/caller-pin.json": { bytes: 3642, sha256: "7e6adbccf8436c90e23e3ee2338cbac093c33968628e5c5cae5c7d697abb13b7" },
  "references/LICENSE.txt": { bytes: 1071, sha256: "044d7291c37a2ead106ea4b4c26f713e63b7834637ed634da640f74e8cbe4625" },
};
const FIXTURE_KEY = "211998-installed-feedback-fixture-key";
const payer = `0x${"2".repeat(40)}`;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const DIRECT = `
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [caller, mode, operationPath, checkpoint, grantPath, resultPath, disposition, reason] = process.argv.slice(2);
const { Client } = await import(pathToFileURL(path.join(caller, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js")).href);
const { StreamableHTTPClientTransport } = await import(pathToFileURL(path.join(caller, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js")).href);
const recovery = await import(pathToFileURL(path.join(caller, "src/mcp-recovery.mjs")).href);
const mcp = await import(pathToFileURL(path.join(caller, "src/mcp-caller-result.mjs")).href);
const names = [];
let sdk;
let connected;
let listed = [];
async function endpoint() {
  if (mode === "report" || mode === "recover") {
    const operation = JSON.parse(await readFile(operationPath, "utf8"));
    return operation.endpointUrl;
  }
  return JSON.parse(await readFile(operationPath, "utf8")).endpointUrl;
}
const client = {
  async listTools(...args) {
    sdk ??= new Client({ name: "direct-installed-caller", version: "0.1.1" });
    connected ??= sdk.connect(new StreamableHTTPClientTransport(new URL(await endpoint())));
    await connected;
    const listedTools = await sdk.listTools(...args);
    listed = listedTools.tools.map((tool) => tool.name);
    return listedTools;
  },
  async callTool(...args) {
    names.push(args[0]?.name ?? null);
    sdk ??= new Client({ name: "direct-installed-caller", version: "0.1.1" });
    connected ??= sdk.connect(new StreamableHTTPClientTransport(new URL(await endpoint())));
    await connected;
    return sdk.callTool(...args);
  },
  getToolOutputValidator: (...args) => sdk.getToolOutputValidator(...args),
  close: () => sdk?.close?.() ?? Promise.resolve(),
};
function resultBody(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)) {
    return result.structuredContent;
  }
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}
function summary(result) {
  const capability = mcp.readMcpCallerResultCapability(result);
  const body = resultBody(result);
  return {
    present: capability.present === true,
    reason: capability.reason,
    tool: capability.tool,
    isError: result?.isError === true,
    hasMeta: Boolean(result?._meta),
    recoveryVersion: result?._meta?.["samedaydesk/recovery"]?.version ?? null,
    contentCount: Array.isArray(result?.content) ? result.content.length : 0,
    ok: body?.ok === true,
    positionCount: body?.positionCount ?? null,
  };
}
try {
  if (mode === "pay") {
    const loadGrant = async () => JSON.parse(await readFile(grantPath, "utf8"));
    const store = recovery.mcpRecoveryFileStore(path.resolve(checkpoint));
    const handle = await recovery.startPaidMcpResult({
      client, store, input: JSON.parse(await readFile(operationPath, "utf8")), loadGrant,
    });
    const saved = await handle.handoff();
    if (saved?.result) await writeFile(resultPath, JSON.stringify(saved.result));
    process.stdout.write(JSON.stringify({
      mode, state: saved?.state ?? null, failure: saved?.failure ?? null, toolCalls: names, listed,
      result: saved?.result ? summary(saved.result) : null,
    }) + "\\n");
  } else if (mode === "recover") {
    const operation = JSON.parse(await readFile(operationPath, "utf8"));
    await client.listTools();
    const result = await client.callTool({
      name: "recover_paid_result",
      arguments: { name: operation.name, arguments: operation.arguments },
      _meta: {
        "x402/payment": operation.payment,
        "samedaydesk/recovery-call": {
          operationId: operation.operationId,
          reservationId: operation.reservationId,
          principalId: operation.principalId,
          grantId: operation.grantId,
        },
      },
    });
    process.stdout.write(JSON.stringify({ mode, toolCalls: names, listed, result: summary(result) }) + "\\n");
  } else if (mode === "report") {
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    const capability = mcp.readMcpCallerResultCapability(result);
    await client.listTools();
    const input = { token: capability.token, disposition };
    if (reason) input.reasonCategory = reason;
    const statement = await mcp.reportMcpCallerResult(client, input);
    process.stdout.write(JSON.stringify({
      mode, toolCalls: names, listed, present: capability.present === true,
      statement: {
        ok: statement.ok === true,
        accepted: statement.accepted === true,
        bound: statement.bound === true,
        charged: statement.charged === true,
        payerIdentity: statement.payerIdentity === true,
        usefulness: statement.usefulness,
        code: statement.code,
        disposition: statement.disposition,
        reasonCategory: statement.reasonCategory,
        idempotentReplay: statement.idempotentReplay === true,
        parent: statement.parent,
        retainedDisposition: statement.retainedDisposition,
      },
    }) + "\\n");
  } else {
    throw new Error("mode_rejected");
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ mode, failure: typeof error?.code === "string" ? error.code : "failed" }) + "\\n");
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
`;

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function runScript(args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      let body = null;
      try { body = JSON.parse(stdout); } catch { body = null; }
      resolve({ code, body, stdout, stderr, pid: child.pid });
    });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

function hidden(text, secrets) {
  return secrets.every((secret) => !secret || !text.includes(secret));
}

function toolJson(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}

let acquired;
function acquireCaller() {
  acquired ??= (async () => {
    const work = path.join(await mkdtemp(path.join(tmpdir(), "installed-feedback-211998-")), "work");
    const result = await runScript(["acquire", "--work", work, "--install", "yes"], 180_000);
    if (result.code !== 0 || result.body?.outcome !== "acquired") {
      throw new Error(`acquire failed ${result.code}`);
    }
    return { caller: result.body.callerDir, body: result.body };
  })();
  return acquired;
}

async function fixture(t, { feedback: feedbackConfig = null, env = {} } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "installed-feedback-merchant-"));
  const dataDir = path.join(directory, "merchant");
  await mkdir(dataDir);
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
      output = {
        success: true, network: "eip155:8453", payer,
        transaction: `0x${counts.settle.toString(16).padStart(64, "0")}`,
      };
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
  let target;
  let child;
  let ready;
  const proxyState = { loseNextFeedback: false, lost: 0, calls: [], requests: 0 };
  const proxy = createServer(async (req, res) => {
    try {
      proxyState.requests += 1;
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const message = raw.length ? JSON.parse(raw.toString()) : null;
      if (message?.method === "tools/call") proxyState.calls.push(message.params.name);
      if (proxyState.loseNextFeedback && message?.method === "tools/call" && message.params?.name === "report_caller_result") {
        proxyState.loseNextFeedback = false;
        proxyState.lost += 1;
        res.destroy();
        return;
      }
      const response = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        ...(raw.length ? { body: raw } : {}),
        redirect: "error",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
      res.end(bytes);
    } catch {
      res.destroy();
    }
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
    const callerResultFeedback = extra.callerResultFeedback ?? feedbackConfig;
    await writeFile(configFile, JSON.stringify({
      dataDir, port, endpointUrl, tenantId: "tenant-a",
      facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`,
      ...(callerResultFeedback ? { callerResultFeedback } : {}),
    }));
    child = spawn(process.execPath, ["fixtures/mcp-task-recovery-loopback.mjs", configFile], {
      cwd: root,
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`receiver_timeout ${output.slice(-500)}`)), 20_000);
      const onData = (part) => {
        output += part;
        const lines = output.split("\n");
        if (!output.endsWith("\n")) lines.pop();
        const line = lines.find((item) => item.includes('"ready":true'));
        if (!line) return;
        clearTimeout(timer);
        try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`receiver_exited ${output.slice(-500)}`)); });
    });
    return { pid: child.pid, ready };
  }
  async function operation(name, inputArgs) {
    const client = new Client({ name: "installed-feedback-catalog", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpointUrl)));
    const catalog = await client.listTools();
    const accepted = catalog.tools.find((tool) => tool.name === name)._meta.x402.accepts[0];
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
      extensions: { "payment-identifier": { info: { required: false, id: `feedback_${suffix}` } } },
    };
    const input = {
      endpointUrl, tenantId: "tenant-a", principalId: "principal-a", name, arguments: inputArgs, payment,
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
    return { input, grant, inputFile, checkpoint, grantFile, accepted };
  }
  async function skill(caller, action, op) {
    const args = action === "start"
      ? ["recover", "--caller", caller, "--action", "start", "--operation", op.inputFile, "--checkpoint", op.checkpoint, "--grant", op.grantFile]
      : ["recover", "--caller", caller, "--action", "resume", "--checkpoint", op.checkpoint, "--grant", op.grantFile];
    const result = await runScript(args);
    assert.equal(hidden(result.stdout + result.stderr, [op.input.payment.payload.signature, op.input.payment.payload.authorization.nonce]), true);
    return result;
  }
  async function feedback(caller, resultFile, disposition, reason) {
    const args = ["feedback", "--caller", caller, "--channel", "mcp", "--endpoint", endpointUrl, "--result", resultFile, "--disposition", disposition];
    if (reason) args.push("--reason", reason);
    return runScript(args);
  }
  async function direct(caller, mode, op, resultPath, disposition, reason) {
    const entry = path.join(directory, `direct-${mode}.mjs`);
    await writeFile(entry, DIRECT);
    const childProc = spawn(process.execPath, [entry, caller, mode, op.inputFile, op.checkpoint, op.grantFile, resultPath || "", disposition || "", reason || ""], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    childProc.stdout.on("data", (chunk) => { stdout += chunk; });
    childProc.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => childProc.kill("SIGKILL"), 60_000);
      childProc.once("exit", (status) => { clearTimeout(timer); resolve(status); });
    });
    assert.equal(hidden(stdout + stderr, [op.input.payment.payload.signature, op.input.payment.payload.authorization.nonce]), true);
    let body = null;
    try { body = JSON.parse(stdout); } catch { body = null; }
    return { code, body, stdout, stderr, pid: childProc.pid };
  }
  t.after(async () => {
    await stop(child);
    proxy.closeAllConnections();
    facilitator.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => facilitator.close(resolve)),
    ]);
    await rm(directory, { recursive: true, force: true });
  });
  const started = await start();
  return {
    counts, proxyState, endpointUrl, directory, dataDir, start, operation, skill, feedback, direct, ready: started.ready,
    flush: () => fetch(`${target}/fixture-flush`, { method: "POST" }).then((response) => response.json()),
    declarations: () => fetch(`${target}/fixture-declarations`).then((response) => response.json()),
    handlerCounts: () => fetch(`${target}/fixture-counts`).then((response) => response.json()),
    merchantBase: () => target,
  };
}

test("default recovery loopback ignores an environment feedback key", async (t) => {
  const harness = await fixture(t, { env: { CALLER_RESULT_FEEDBACK_KEY: FIXTURE_KEY } });
  assert.equal(harness.ready.toolCount, 2);
  assert.equal(harness.ready.feedback, false);
  const client = new Client({ name: "default-loopback", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(harness.endpointUrl)));
  const catalog = await client.listTools();
  await client.close();
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), ["opportunity_preflight", "recover_paid_result", "transaction_receipt"]);
  assert.deepEqual(await harness.handlerCounts(), { opportunity: 0, receipt: 0 });
  const missing = await fetch(`${harness.merchantBase()}/fixture-declarations`);
  assert.equal(missing.status, 404);
});

test("installed caller reports a free statement for the issued morpho capability", { skip: skipJourney, timeout: 300_000 }, async (t) => {
  for (const [relative, expected] of Object.entries(INSTALLED_FILES)) {
    const bytes = await readFile(path.join(installedRoot, relative));
    assert.equal(bytes.length, expected.bytes, relative);
    assert.equal(sha256(bytes), expected.sha256, relative);
  }
  const { PIN } = await import(pathToFileURL(script).href);
  const { caller, body: acquiredBody } = await acquireCaller();
  assert.equal(acquiredBody.version, "0.1.1");
  assert.equal(acquiredBody.bytes, PIN.files.archive.bytes);
  assert.equal(acquiredBody.archiveSha256, PIN.files.archive.sha256);
  assert.equal(acquiredBody.memberCount, 15);
  assert.equal(acquiredBody.hostedAcceptance, false);
  assert.equal(acquiredBody.npmInstall, "completed");
  const { readMcpCallerResultCapability } = await import(pathToFileURL(path.join(caller, "src/mcp-caller-result.mjs")).href);

  const harness = await fixture(t, { feedback: { key: FIXTURE_KEY } });
  assert.equal(harness.ready.feedback, true);
  assert.equal(harness.ready.toolCount, 3);
  const catalogClient = new Client({ name: "feedback-catalog", version: "1" });
  await catalogClient.connect(new StreamableHTTPClientTransport(new URL(harness.endpointUrl)));
  const catalog = await catalogClient.listTools();
  await catalogClient.close();
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), [
    "morpho_position", "opportunity_preflight", "recover_paid_result", "report_caller_result", "transaction_receipt",
  ]);

  const usefulOp = await harness.operation("morpho_position", { address: FIXTURE_ADDRESS });
  assert.equal(usefulOp.accepted.amount, "20000");
  const beforeGrant = harness.proxyState.requests;
  await writeFile(usefulOp.grantFile, JSON.stringify({ ...usefulOp.grant, grantId: "grant-changed" }));
  const changed = await harness.skill(caller, "start", usefulOp);
  assert.equal(changed.code, 3, changed.stderr);
  assert.equal(changed.body.outcome, "handle_rejected");
  assert.equal(changed.body.failure, "grant_grantId_changed");
  assert.equal(harness.proxyState.requests, beforeGrant);
  assert.equal(harness.counts.verify, 0);
  await writeFile(usefulOp.grantFile, JSON.stringify(usefulOp.grant), { mode: 0o600 });

  const paid = await harness.skill(caller, "start", usefulOp);
  assert.equal(paid.code, 0, paid.stderr);
  assert.equal(paid.body.outcome, "restored_result");
  assert.equal(paid.body.usefulness, "unknown");
  assert.equal(paid.body.paymentCreated, false);
  const usefulResult = paid.body.retainedResult;
  const usefulCapability = readMcpCallerResultCapability(usefulResult);
  assert.equal(usefulCapability.present, true);
  assert.equal(usefulCapability.tool, "report_caller_result");
  assert.equal(usefulResult._meta["samedaydesk/recovery"].version, 1);
  assert.equal(usefulResult._meta["samedaydesk/mcp-caller-result"].charged, false);
  const usefulPayload = toolJson(usefulResult);
  assert.equal(usefulPayload.ok, true);
  assert.equal(usefulPayload.positionCount, 1);
  assert.equal(usefulPayload.address, FIXTURE_ADDRESS.toLowerCase());
  assert.equal(hidden(paid.stdout + paid.stderr, [usefulOp.input.payment.payload.authorization.nonce]), true);
  await harness.flush();
  assert.equal(harness.counts.verify, 1);
  assert.equal(harness.counts.settle, 1);
  assert.deepEqual(await harness.handlerCounts(), { opportunity: 0, receipt: 0, morpho: 1 });

  const recovered = await harness.direct(caller, "recover", usefulOp, "");
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.equal(recovered.body.result.present, false);
  assert.equal(recovered.body.result.reason, "absent");
  assert.equal(recovered.body.result.recoveryVersion, 1);
  assert.equal(recovered.body.result.ok, true);
  assert.deepEqual(recovered.body.toolCalls, ["recover_paid_result"]);
  assert.equal(harness.counts.verify, 1);
  assert.equal(harness.counts.settle, 1);
  assert.equal((await harness.handlerCounts()).morpho, 1);
  const recoveredFile = path.join(harness.directory, "recovered-result.json");
  await writeFile(recoveredFile, JSON.stringify({
    content: [{ type: "text", text: "{}" }],
    structuredContent: { ok: true, positionCount: 1 },
    _meta: { "samedaydesk/recovery": { version: 1 } },
  }));
  const requestsBeforeMissing = harness.proxyState.requests;
  const missing = await harness.feedback(caller, recoveredFile, "useful");
  assert.equal(missing.code, 0, missing.stderr);
  assert.equal(missing.body.outcome, "missing_input");
  assert.equal(missing.body.connected, false);
  assert.equal(missing.body.posted, false);
  assert.equal(missing.body.accepted, undefined);
  assert.equal(harness.proxyState.requests, requestsBeforeMissing);

  const usefulFile = path.join(harness.directory, "useful-result.json");
  await writeFile(usefulFile, JSON.stringify(usefulResult));
  const usefulFeedback = await harness.feedback(caller, usefulFile, "useful", "matched_task");
  assert.equal(usefulFeedback.code, 0, usefulFeedback.stderr);
  assert.equal(usefulFeedback.body.outcome, "caller_asserted_acceptance");
  assert.equal(usefulFeedback.body.connected, true);
  assert.equal(usefulFeedback.body.accepted, true);
  assert.equal(usefulFeedback.body.charged, false);
  assert.equal(usefulFeedback.body.statement.usefulness, "unknown");
  assert.equal(usefulFeedback.body.statement.bound, false);
  assert.equal(usefulFeedback.body.statement.disposition, "useful");
  assert.equal(usefulFeedback.body.tokenEcho, false);
  const usefulBody = toolJson(usefulFeedback.body.retainedResult);
  assert.equal(usefulBody.accepted, true);
  assert.equal(usefulBody.charged, false);
  assert.equal(usefulBody.payerIdentity, false);
  assert.equal(usefulBody.usefulness, "unknown");
  assert.equal(usefulBody.parent, "pending");
  assert.equal(usefulBody.bound, false);
  assert.equal(usefulBody.idempotentReplay, false);
  assert.equal(usefulBody.reasonCategory, "matched_task");
  assert.equal(hidden(usefulFeedback.stdout + usefulFeedback.stderr, [usefulCapability.token, usefulOp.input.payment.payload.authorization.nonce]), true);
  assert.equal(harness.counts.verify, 1);
  assert.equal(harness.counts.settle, 1);
  assert.equal((await harness.handlerCounts()).morpho, 1);
  assert.deepEqual((await harness.declarations()).declarations.map((row) => row.disposition), ["useful"]);

  const duplicate = await harness.feedback(caller, usefulFile, "useful", "matched_task");
  assert.equal(duplicate.body.outcome, "caller_asserted_acceptance");
  assert.equal(toolJson(duplicate.body.retainedResult).idempotentReplay, true);
  const conflict = await harness.feedback(caller, usefulFile, "not_useful", "wrong_output");
  assert.equal(conflict.body.outcome, "tool_refusal");
  assert.equal(conflict.body.statement.code, "conflicting_statement");
  assert.equal(conflict.body.statement.accepted, false);
  assert.equal(conflict.body.statement.usefulness, "unknown");
  assert.equal(toolJson(conflict.body.retainedResult).retainedDisposition, "useful");
  assert.equal(harness.counts.settle, 1);
  assert.equal((await harness.handlerCounts()).morpho, 1);

  const changedFile = path.join(harness.directory, "changed-result.json");
  const changedResult = structuredClone(usefulResult);
  changedResult.structuredContent = { ...changedResult.structuredContent, positionCount: 0, note: "changed-body" };
  changedResult.content = [{ type: "text", text: JSON.stringify(changedResult.structuredContent) }];
  await writeFile(changedFile, JSON.stringify(changedResult));
  const changedFeedback = await harness.feedback(caller, changedFile, "useful", "matched_task");
  assert.equal(toolJson(changedFeedback.body.retainedResult).idempotentReplay, true);
  assert.equal((await harness.declarations()).declarations.length, 1);

  const restarted = await harness.start();
  assert.notEqual(restarted.pid, paid.pid);
  const cold = await harness.declarations();
  assert.equal(cold.declarations.length, 1);
  assert.equal(cold.declarations[0].source, "caller");
  assert.equal(cold.declarations[0].inferred, false);
  assert.equal(cold.declarations[0].disposition, "useful");
  assert.equal(cold.declarations[0].reasonCategory, "matched_task");
  const directReport = await harness.direct(caller, "report", usefulOp, usefulFile, "useful", "matched_task");
  assert.equal(directReport.code, 0, directReport.stderr);
  assert.equal(directReport.body.present, true);
  assert.equal(directReport.body.statement.accepted, true);
  assert.equal(directReport.body.statement.idempotentReplay, true);
  assert.equal(directReport.body.statement.parent, "pending");
  assert.equal(directReport.body.statement.usefulness, "unknown");
  assert.equal(directReport.body.statement.charged, false);
  assert.equal(directReport.body.statement.payerIdentity, false);
  assert.equal(directReport.body.listed.includes("report_caller_result"), true);
  assert.equal(hidden(directReport.stdout, [usefulCapability.token]), true);
  assert.equal(harness.counts.verify, 1);
  assert.equal(harness.counts.settle, 1);

  const negativeOp = await harness.operation("morpho_position", { address: FIXTURE_ADDRESS });
  const negativeFile = path.join(harness.directory, "negative-result.json");
  const negativePaid = await harness.direct(caller, "pay", negativeOp, negativeFile);
  assert.equal(negativePaid.code, 0, negativePaid.stderr);
  assert.equal(negativePaid.body.state, "completed");
  assert.equal(negativePaid.body.result.present, true);
  assert.equal(negativePaid.body.result.positionCount, 1);
  assert.deepEqual(negativePaid.body.toolCalls, ["morpho_position"]);
  assert.equal(negativePaid.body.listed.includes("morpho_position"), true);
  await harness.flush();
  const negativeResult = JSON.parse(await readFile(negativeFile, "utf8"));
  const negativeCapability = readMcpCallerResultCapability(negativeResult);
  assert.equal(negativeCapability.present, true);
  assert.notEqual(negativeCapability.token, usefulCapability.token);
  const negativeFeedback = await harness.feedback(caller, negativeFile, "not_useful", "wrong_output");
  assert.equal(negativeFeedback.body.outcome, "caller_asserted_acceptance");
  assert.equal(negativeFeedback.body.statement.disposition, "not_useful");
  assert.equal(negativeFeedback.body.statement.reasonCategory, "wrong_output");
  assert.equal(negativeFeedback.body.statement.usefulness, "unknown");
  assert.equal(toolJson(negativeFeedback.body.retainedResult).parent, "pending");
  assert.equal(toolJson(negativeFeedback.body.retainedResult).idempotentReplay, false);
  assert.equal(hidden(negativeFeedback.stdout, [negativeCapability.token, negativeOp.input.payment.payload.authorization.nonce]), true);
  assert.equal(harness.counts.verify, 2);
  assert.equal(harness.counts.settle, 2);
  assert.equal((await harness.handlerCounts()).morpho, 1);
  const both = await harness.declarations();
  assert.deepEqual(both.declarations.map((row) => row.disposition).sort(), ["not_useful", "useful"]);
  assert.equal(both.declarations.every((row) => row.source === "caller" && row.inferred === false), true);
  assert.notEqual(both.declarations[0].paidEvidenceId, both.declarations[1].paidEvidenceId);

  const feedbackJournal = await readFile(path.join(harness.dataDir, "caller-result-feedback.ndjson"), "utf8");
  const deliveries = await readFile(path.join(harness.dataDir, "mcp-tool-delivery.v1.ndjson"), "utf8");
  const events = await readFile(path.join(harness.dataDir, "commerce-events.ndjson"), "utf8");
  for (const text of [feedbackJournal, deliveries, events]) {
    assert.equal(text.includes(usefulCapability.token), false);
    assert.equal(text.includes(negativeCapability.token), false);
    assert.equal(text.includes(usefulOp.input.payment.payload.authorization.nonce), false);
    assert.equal(text.includes(negativeOp.input.payment.payload.authorization.nonce), false);
  }
  const eventRows = events.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const paidEvents = eventRows.filter((row) => row.result === "paid_success" && row.binding?.tool === "morpho_position");
  assert.equal(paidEvents.length, 2);
  assert.equal(paidEvents.every((row) => row.settlementState === "succeeded"), true);
  const deliveryRows = deliveries.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(deliveryRows.length, 2);
  assert.equal(deliveryRows.every((row) => row.tool === "morpho_position" && row.usefulness === "unknown"), true);
  assert.equal(existsSync(path.join(harness.dataDir, "commerce-settlements.ndjson")), false);
  const statements = feedbackJournal.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(statements.every((row) => row.usefulness === "unknown" && row.source === "caller" && row.channel === "mcp"), true);

  const tampered = structuredClone(usefulResult);
  const token = tampered._meta["samedaydesk/mcp-caller-result"].token;
  const last = token.at(-1) === "a" ? "b" : "a";
  tampered._meta["samedaydesk/mcp-caller-result"].token = `${token.slice(0, -1)}${last}`;
  const tamperedFile = path.join(harness.directory, "tampered-result.json");
  await writeFile(tamperedFile, JSON.stringify(tampered));
  const tamperedFeedback = await harness.feedback(caller, tamperedFile, "useful");
  assert.equal(tamperedFeedback.body.outcome, "tool_refusal");
  assert.equal(tamperedFeedback.body.statement.code, "tampered_capability");
  assert.equal(tamperedFeedback.body.statement.accepted, false);
  assert.equal(tamperedFeedback.body.statement.usefulness, "unknown");
  assert.equal((await harness.declarations()).declarations.length, 2);

  harness.proxyState.loseNextFeedback = true;
  const dropped = await harness.feedback(caller, usefulFile, "useful", "matched_task");
  assert.equal(dropped.body.outcome, "transport_failure");
  assert.equal(dropped.body.accepted, false);
  assert.equal(dropped.body.statement?.code, "transport_failed");
  assert.equal(harness.proxyState.lost, 1);
  assert.equal(harness.counts.verify, 2);
  assert.equal(harness.counts.settle, 2);
  assert.equal((await harness.declarations()).declarations.length, 2);

  const expired = await harness.start({ callerResultFeedback: { key: FIXTURE_KEY, nowMs: Date.now() + (8 * 24 * 60 * 60 * 1000) } });
  assert.notEqual(expired.pid, restarted.pid);
  const expiredFeedback = await harness.feedback(caller, usefulFile, "useful", "matched_task");
  assert.equal(expiredFeedback.body.outcome, "tool_refusal");
  assert.equal(expiredFeedback.body.statement.code, "expired_capability");
  assert.equal(expiredFeedback.body.statement.accepted, false);
  assert.equal(expiredFeedback.body.statement.usefulness, "unknown");
  const expiredDeclarations = await harness.declarations();
  assert.equal(expiredDeclarations.declarations.length, 2);
  assert.equal(expiredDeclarations.declarations.every((row) => row.source === "caller" && row.inferred === false), true);

  const absent = await fixture(t, { feedback: { key: "" } });
  const absentOp = await absent.operation("morpho_position", { address: FIXTURE_ADDRESS });
  const absentPaid = await absent.skill(caller, "start", absentOp);
  assert.equal(absentPaid.code, 0, absentPaid.stderr);
  assert.equal(absentPaid.body.outcome, "restored_result");
  const absentCapability = readMcpCallerResultCapability(absentPaid.body.retainedResult);
  assert.equal(absentCapability.present, false);
  const absentFile = path.join(absent.directory, "absent-result.json");
  await writeFile(absentFile, JSON.stringify(absentPaid.body.retainedResult));
  const absentRequests = absent.proxyState.requests;
  const absentFeedback = await absent.feedback(caller, absentFile, "useful");
  assert.equal(absentFeedback.body.outcome, "missing_input");
  assert.equal(absentFeedback.body.connected, false);
  assert.equal(absent.proxyState.requests, absentRequests);
  assert.equal(absent.counts.verify, 1);
  assert.equal(absent.counts.settle, 1);
  assert.equal((await absent.handlerCounts()).morpho, 1);
  t.diagnostic(JSON.stringify({
    product: PRODUCT,
    archive: acquiredBody.archiveSha256,
    node: process.version,
    verify: harness.counts.verify,
    settle: harness.counts.settle,
    restartedMorphoHandler: 1,
    declarations: 2,
    parent: "pending",
    recoveryCapability: "absent",
  }));
});
