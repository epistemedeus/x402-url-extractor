import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evm as evmClient, Mppx as ClientMppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { mppAssetForNetwork } from "./mpp-dual-stack.mjs";
import { EXTRACT_BATCH_PATH } from "./extract-batch-config.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const SOURCE_HEADER = "x-samedaydesk-agent-source";
const SECRET_URL = "https://private.example/do-not-retain-batch-url";
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);

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

async function startFakeFacilitator({ settleSuccess = true, verifyValid = true } = {}) {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, {
        isValid: verifyValid,
        invalidReason: verifyValid ? undefined : "invalid_signature",
        payer: PAYER,
      });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      if (!settleSuccess) {
        return send(200, { success: false, errorReason: "unknown_settlement", transaction: "", network: NETWORK });
      }
      return send(200, {
        success: true,
        payer: PAYER,
        transaction: `0x${"3".repeat(64)}`,
        network: NETWORK,
      });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant({ dataDir, facilitatorUrl, extraEnv = {}, fetchLogPath,
  startupTimeout = 20_000, args = ["server.js"], onSpawn = () => {} } = {}) {
  const preloadPath = path.join(dataDir, "extract-batch-fetch-hook.mjs");
  await writeFile(preloadPath, `
import { writeFileSync } from "node:fs";
const logPath = ${JSON.stringify(fetchLogPath || path.join(dataDir, "source-fetches.log"))};
const pages = {
  "https://alpha.example/": { status: 200, body: "<!doctype html><title>Alpha</title><h1>Alpha</h1>" },
  "https://beta.example/": { status: 200, body: "<!doctype html><title>Beta</title><h1>Beta</h1>" },
};
globalThis.__SAMEDAYDESK_EXTRACT_BATCH_FETCH__ = async (url) => {
  writeFileSync(logPath, url + "\\n", { flag: "a" });
  const page = pages[url];
  if (!page) {
    const err = new Error("unmapped source");
    err.code = "fetch_error";
    throw err;
  }
  const bytes = new TextEncoder().encode(page.body);
  let delivered = false;
  return {
    status: page.status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html" : null },
    body: {
      getReader() {
        return {
          async read() {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  };
};
`, "utf8");

  const port = await unusedPort();
  const existingNodeOptions = String(process.env.NODE_OPTIONS || "").trim();
  const child = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: MPP_SECRET,
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      EXTRACT_BATCH_ENABLED: "1",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  onSpawn(child);
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new Error(`startup timed out: ${output.slice(-2000)}`)), startupTimeout);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-40_000);
        if (output.includes(`x402-merchant listening on :${port}`)
          && output.includes("MCP server:  POST /mcp (23 paid tools)")) finish();
      };
      const onExit = (code, signal) => finish(new Error(`startup exited before listening: code=${code} signal=${signal}`));
      const onError = (error) => finish(error);
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000).unref();
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge, { id = "batch_commerce_1234567890" } = {}) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "challenge omitted Base exact payment terms");
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: challenge.resource,
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${"5".repeat(64)}`,
      },
    },
    extensions: {
      "payment-identifier": {
        info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id },
      },
    },
  })).toString("base64");
}

async function createMppCredential(response) {
  const client = ClientMppx.create({
    methods: [evmClient({
      account,
      currencies: [mppAssetForNetwork(NETWORK)],
      maxAmount: "0.01",
    })],
    polyfill: false,
  });
  return client.createCredential(response);
}

function jsonPost(body, headers = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function readEvents(dataDir) {
  const raw = await readFile(path.join(dataDir, "commerce-events.ndjson"), "utf8").catch((error) => (
    error?.code === "ENOENT" ? "" : Promise.reject(error)
  ));
  const rows = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return {
    raw,
    http: rows.filter((row) => row.v === 3),
    typed: rows.filter((row) => row.sourceContract === "mcp_typed_outcome" || row.v === 4),
  };
}

async function mcpCall(base, { name, args, payment, headers = {}, id = 77 }) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        ...(payment ? { _meta: { "x402/payment": payment } } : {}),
      },
    }),
  });
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6));
  }
  return JSON.parse(text);
}

function assertExactBatchHttp(event, { status, result, construction, paymentPresent, declared = null }) {
  assert.equal(event.v, 3);
  assert.equal(event.method, "POST");
  assert.equal(event.route, EXTRACT_BATCH_PATH);
  assert.equal(event.kind, "paid");
  assert.equal(event.matched, true);
  assert.equal(event.status, status);
  assert.equal(event.result, result);
  assert.equal(event.requestConstruction, construction);
  assert.equal(event.requestConstructionRequiredKeyCount, 1);
  assert.equal(event.paymentPresent, paymentPresent);
  if (declared) {
    assert.equal(event.declaredAgentDiscoverySource, declared);
  } else {
    assert.equal(Object.hasOwn(event, "declaredAgentDiscoverySource") ? event.declaredAgentDiscoverySource : null, null);
  }
}

test("mounted POST /extract/batch records exact paid classification, construction, and source", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-commerce-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });

  const x402Body = { urls: ["https://alpha.example/"], fields: ["title"] };
  const x402Challenge = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(x402Body, {
    [SOURCE_HEADER]: "agent-skills-v1",
  }));
  assert.equal(x402Challenge.status, 402);
  const x402Payment = testPayment(decodePaymentRequired(x402Challenge), { id: "batch_x402_1234567890ab" });
  const x402Paid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(x402Body, {
    "payment-signature": x402Payment,
    [SOURCE_HEADER]: "agent-skills-v1",
  }));
  assert.equal(x402Paid.status, 200, await x402Paid.text());

  const mppBody = { urls: ["https://beta.example/"], fields: ["title"] };
  const mppChallenge = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(mppBody));
  assert.equal(mppChallenge.status, 402);
  const authorization = await createMppCredential(mppChallenge);
  const mppPaid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(mppBody, { authorization }));
  assert.equal(mppPaid.status, 200, await mppPaid.text());

  const invalid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost({ urls: SECRET_URL }));
  assert.equal(invalid.status, 400);

  const extract = await mcpCall(merchant.base, {
    name: "extract",
    args: { url: "https://example.com" },
    headers: { [SOURCE_HEADER]: "agent-skills-v1" },
    id: 11,
  });
  assert.equal(typeof extract, "object");

  const mcpBatch = await mcpCall(merchant.base, {
    name: "extract_batch",
    args: { urls: ["https://alpha.example/"], fields: ["title"] },
    headers: { [SOURCE_HEADER]: "agent-skills-v1" },
    id: 12,
  });
  assert.equal(typeof mcpBatch, "object");

  await stopChild(merchant.child);
  merchant = null;

  const { raw, http, typed } = await readEvents(dataDir);
  assert.equal(raw.includes(SECRET_URL), false);
  assert.equal(raw.includes("private.example"), false);
  assert.equal(raw.includes("agent-skills-v1"), false);

  const batchHttp = http.filter((row) => row.route === EXTRACT_BATCH_PATH);
  const mcpHttp = http.filter((row) => row.route === "/mcp");
  const unmatchedExtract = http.filter((row) => row.route === "/extract/*");
  assert.equal(mcpHttp.length, 0, "POST /mcp must not write an HTTP v3 row");
  assert.equal(unmatchedExtract.length, 0, "live batch POSTs must not classify as /extract/*");

  const x402ChallengeEvent = batchHttp.find((row) => row.status === 402 && row.declaredAgentDiscoverySource === "agent-skills");
  const x402PaidEvent = batchHttp.find((row) => row.status === 200 && row.paymentProtocol === "x402");
  const mppChallengeEvent = batchHttp.find((row) => row.status === 402 && row.paymentPresent === false && !row.declaredAgentDiscoverySource);
  const mppPaidEvent = batchHttp.find((row) => row.status === 200 && row.paymentProtocol === "mpp");
  const invalidEvent = batchHttp.find((row) => row.status === 400);
  const innerUnpaid = batchHttp.filter((row) => row.status === 402);
  assert.ok(innerUnpaid.length >= 2, "direct unpaid 402 and MCP extract_batch inner hop should both write HTTP /extract/batch");
  assert.ok(x402PaidEvent, "missing x402 paid success");
  assert.ok(mppChallengeEvent, "missing unpaid MPP-offered 402");
  assert.ok(mppPaidEvent, "missing MPP paid success");
  assert.ok(invalidEvent, "missing invalid-body row");
  assertExactBatchHttp(x402ChallengeEvent, {
    status: 402,
    result: "challenge",
    construction: "constructed",
    paymentPresent: false,
    declared: "agent-skills",
  });
  assertExactBatchHttp(x402PaidEvent, {
    status: 200,
    result: "paid_success",
    construction: "constructed",
    paymentPresent: true,
    declared: "agent-skills",
  });
  assertExactBatchHttp(mppPaidEvent, {
    status: 200,
    result: "paid_success",
    construction: "constructed",
    paymentPresent: true,
  });
  assertExactBatchHttp(invalidEvent, {
    status: 400,
    result: "validation_failure",
    construction: "missing_required_input",
    paymentPresent: false,
  });
  assert.equal(x402PaidEvent.replayed, false);
  assert.equal(mppPaidEvent.replayed, false);
  assert.ok(x402ChallengeEvent, "missing sourced x402 402");

  const typedExtract = typed.filter((row) => row.binding?.tool === "extract");
  const typedBatch = typed.filter((row) => row.binding?.tool === "extract_batch");
  assert.ok(typedExtract.length >= 1, "typed MCP extract event missing");
  assert.equal(typedExtract.some((row) => row.declaredAgentDiscoverySource === "agent-skills"), true);
  assert.equal(typedBatch.length, 0, "extract_batch stays on the HTTP batch plane, not typed extract");
});

test("mounted POST /extract/batch records settlement error without unmatched fallback", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-commerce-error-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator({ settleSuccess: false });
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const body = { urls: ["https://alpha.example/"] };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body)));
  const payment = testPayment(challenge, { id: "batch_error_1234567890ab" });
  const paid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.notEqual(paid.status, 200);
  await paid.text();
  const retry = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.equal(retry.status, 503);
  await retry.text();
  await stopChild(merchant.child);
  merchant = null;
  const { http } = await readEvents(dataDir);
  const batch = http.filter((row) => row.route === EXTRACT_BATCH_PATH);
  const errorRow = batch.find((row) => row.status === 503)
    || batch.find((row) => row.paymentPresent === true && row.status !== 200 && row.status !== 402);
  assert.ok(errorRow, `missing paid error row: ${JSON.stringify(batch.map((row) => ({ status: row.status, result: row.result, route: row.route })))}`);
  assert.equal(errorRow.route, EXTRACT_BATCH_PATH);
  assert.equal(errorRow.kind, "paid");
  assert.equal(errorRow.matched, true);
  assert.equal(errorRow.requestConstruction, "constructed");
  assert.ok(["service_failure", "validation_failure"].includes(errorRow.result), errorRow.result);
  assert.equal(http.some((row) => row.route === "/extract/*"), false);
});

test("combined Claude Goose and no-source sessions retain one owning event per request", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "combined-runtime-commerce-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const labels = ["claude-code-marketplace-v1", "goose-native-v1", null];
  const bodies = [{ urls: ["https://alpha.example/"], fields: ["title"] },
    { urls: ["https://beta.example/"], fields: ["title"] },
    { urls: ["https://alpha.example/"] }];
  const challenges = await Promise.all(labels.map(async (label, index) => {
    const headers = label ? { [SOURCE_HEADER]: label } : {};
    const [direct, batch] = await Promise.all([
      mcpCall(merchant.base, { name: "extract", args: { url: "https://example.com" }, headers, id: 100 + index }),
      mcpCall(merchant.base, { name: "extract_batch", args: bodies[index], headers, id: 200 + index }),
    ]);
    assert.equal(direct.result.isError, true);
    assert.equal(batch.result._meta["samedaydesk/http"].status, 402);
    return batch.result;
  }));
  const credential = JSON.parse(Buffer.from(testPayment(challenges[0].structuredContent,
    { id: "combined_x402_1234567890ab" }), "base64").toString());
  const mppChallenge = new Response(null, { status: 402,
    headers: challenges[1]._meta["samedaydesk/http"].headers });
  const authorization = await createMppCredential(mppChallenge);
  const paid = await Promise.all([
    mcpCall(merchant.base, { name: "extract_batch", args: bodies[0], payment: credential,
      headers: { [SOURCE_HEADER]: labels[0] }, id: 300 }),
    mcpCall(merchant.base, { name: "extract_batch", args: bodies[1],
      headers: { [SOURCE_HEADER]: labels[1], authorization }, id: 301 }),
  ]);
  for (const result of paid) assert.equal(result.result._meta["samedaydesk/http"].status, 200, JSON.stringify(result));
  const invalidBodies = [
    { urls: [42] }, { urls: [true] }, { urls: ["not-a-url"] },
    { urls: ["http://example.com"] }, { urls: ["https://127.0.0.1"] },
    { urls: ["https://u:p@example.com"] },
    { urls: ["https://example.com"], fields: ["nonexistent"] },
    { urls: ["https://example.com"], fields: [] },
    { urls: ["https://example.com"], fields: ["title", "title"] },
    { urls: ["https://example.com"], extra: true },
  ];
  for (const body of invalidBodies) {
    const response = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body));
    assert.equal(response.status, 400);
    await response.text();
  }
  const deleted = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, { method: "DELETE" });
  await deleted.text();
  await stopChild(merchant.child); merchant = null;
  const { raw, http, typed } = await readEvents(dataDir);
  assert.equal(http.some((row) => row.route === "/mcp" || row.route === "/extract/*"), false);
  const batch = http.filter((row) => row.route === EXTRACT_BATCH_PATH);
  assert.equal(batch.length, 5 + invalidBodies.length);
  const observed = typed.filter((row) => row.action === "emit");
  const diagnostics = typed.filter((row) => row.action === "drop");
  assert.equal(observed.length, 3);
  assert.equal(diagnostics.every((row) => !Object.hasOwn(row, "declaredAgentDiscoverySource")), true);
  assert.deepEqual(observed.map((row) => row.declaredAgentDiscoverySource || null).sort(),
    ["claude-code-marketplace", "goose-native", null].sort());
  assert.equal(observed.every((row) => row.binding.tool === "extract" && !row.demand && !row.revenue && !row.independentUse), true);
  assert.equal(batch.filter((row) => row.status === 402 && row.requestConstruction === "constructed").length, 3);
  assert.equal(batch.filter((row) => row.status === 400 && row.requestConstruction === "missing_required_input").length, invalidBodies.length);
  for (const [protocol, source] of [["x402", "claude-code-marketplace"], ["mpp", "goose-native"]]) {
    const rows = batch.filter((row) => row.status === 200 && row.paymentProtocol === protocol);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].declaredAgentDiscoverySource, source);
    assert.ok(rows[0].settlementReference);
    assert.equal(rows[0].replayed, false);
  }
  assert.equal(facilitator.calls.settle, 2, "one settlement per x402/MPP paid call");
  assert.doesNotMatch(raw, /claude-code-marketplace-v1|goose-native-v1|https:\/\/alpha\.example|https:\/\/beta\.example/);
});

test("batch fixture startup timeout reaps a SIGTERM-resistant child", { timeout: 10_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "batch-startup-cleanup-"));
  let child;
  try {
    await assert.rejects(startMerchant({ dataDir, startupTimeout: 500,
      args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      onSpawn: (value) => { child = value; } }), /startup timed out/);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  } finally {
    if (child) await stopChild(child);
    await rm(dataDir, { recursive: true, force: true });
  }
});
