import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { EXTRACT_BATCH_PATH } from "./extract-batch-config.mjs";
import { LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC, LOCKFILE_PIN_DELTA_PATH, LOCKFILE_PIN_DELTA_QUOTE_MEANING } from "./lockfile-pin-delta-config.mjs";
import { lockfilePinDeltaOutputSchema } from "./lockfile-pin-delta.mjs";

const validateOutput = new Ajv2020({ strict: false, allErrors: true }).compile(lockfilePinDeltaOutputSchema());
function assertOutput(result) {
  assert.equal(validateOutput(result), true, JSON.stringify(validateOutput.errors));
}

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const journeyBefore = JSON.parse(readFileSync(path.join(cwd, "fixtures/lockfile-pin-delta/journey-before.json"), "utf8"));
const journeyAfter = JSON.parse(readFileSync(path.join(cwd, "fixtures/lockfile-pin-delta/journey-after.json"), "utf8"));

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
      return send(200, { kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }], extensions: [], signers: {} });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(200, { isValid: verifyValid, invalidReason: verifyValid ? undefined : "invalid_signature", payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      if (!settleSuccess) return send(200, { success: false, errorReason: "unknown_settlement", transaction: "", network: NETWORK });
      return send(200, { success: true, payer: PAYER, transaction: `0x${"3".repeat(64)}`, network: NETWORK });
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { calls, close: () => new Promise((resolve) => server.close(resolve)), url: `http://127.0.0.1:${server.address().port}` };
}

async function startMerchant({ dataDir, facilitatorUrl, enabled = true, extraEnv = {} } = {}) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
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
      LOCKFILE_PIN_DELTA_ENABLED: enabled ? "1" : "0",
      EXTRACT_BATCH_ENABLED: "0",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output };
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function testPayment(challenge, { id = "lockfile_order_1234567890" } = {}) {
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.ok(accepted, "challenge omitted Base exact payment terms");
  const nonce = `0x${Buffer.from(id).toString("hex").padEnd(64, "0").slice(0, 64)}`;
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
        nonce,
      },
    },
    extensions: { "payment-identifier": { info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id } } },
  })).toString("base64");
}

function jsonPost(body, headers = {}) {
  return { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

test("flag off leaves live extract and catalogs unchanged", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-off-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: false });
  const deadline = Date.now() + 20_000;
  while (!merchant.output().includes("MCP server:  POST /mcp (22 paid tools)")) {
    if (Date.now() > deadline) throw new Error(`MCP mount timed out:\n${merchant.output().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const [openapi, catalog, extract, manifest] = await Promise.all([
    fetch(`${merchant.base}/openapi.json`).then((r) => r.json()),
    fetch(`${merchant.base}/api/actions`).then((r) => r.json()),
    fetch(`${merchant.base}/extract?url=https%3A%2F%2Fexample.com`),
    fetch(`${merchant.base}/.well-known/x402`).then((r) => r.json()),
  ]);
  assert.equal(openapi.paths[LOCKFILE_PIN_DELTA_PATH], undefined);
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 25);
  assert.equal(catalog.actions.some((action) => action.route === LOCKFILE_PIN_DELTA_PATH), false);
  assert.equal(manifest.items.some((item) => item.resource?.routeTemplate === LOCKFILE_PIN_DELTA_PATH), false);
  assert.equal(extract.status, 402);
  const missing = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost({ before: journeyBefore, after: journeyAfter }));
  assert.equal(missing.status, 404);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);
});

test("mounted success, no-change, malformed, oversize, and wrong-replay-input", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-on-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const deadline = Date.now() + 20_000;
  while (!merchant.output().includes("MCP server:  POST /mcp (23 paid tools)")) {
    if (Date.now() > deadline) throw new Error(`MCP mount timed out:\n${merchant.output().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const html = await readFile(path.join(cwd, "fixtures/lockfile-pin-delta/not-a-lock.html"), "utf8");
  const unpaidInvalid = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost({ before: html, after: journeyAfter }));
  assert.equal(unpaidInvalid.status, 400);
  assert.equal((await unpaidInvalid.json()).charged, false);
  assert.equal(facilitator.calls.settle, 0);

  const pathBody = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost({ before: "./package-lock.json", after: journeyAfter }));
  assert.equal(pathBody.status, 400);
  assert.equal((await pathBody.json()).code, "filesystem_input");

  const oversized = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost({
    before: { ...journeyBefore, pad: "x".repeat(200_000) },
    after: journeyAfter,
  }));
  assert.ok([400, 413].includes(oversized.status), `unexpected oversize status ${oversized.status}`);
  assert.equal((await oversized.json()).charged, false);

  const deltaBody = { before: journeyBefore, after: journeyAfter };
  const challengeResponse = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(deltaBody));
  assert.equal(challengeResponse.status, 402);
  const challenge = decodePaymentRequired(challengeResponse);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC);
  assert.equal(accepted.payTo, PAY_TO);

  const openapi = await fetch(`${merchant.base}/openapi.json`).then((r) => r.json());
  assert.equal(openapi.paths[LOCKFILE_PIN_DELTA_PATH].post.operationId, "compareLockfilePinDelta");
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 26);

  const payment = testPayment(challenge, { id: "lockfile_paid_1234567890ab" });
  const paid = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(deltaBody, { "payment-signature": payment }));
  const result = await paid.json();
  assert.equal(paid.status, 200, JSON.stringify(result));
  assertOutput(result);
  assert.equal(result.analysis, "actionable");
  assert.equal(result.charged, true);
  assert.equal(result.ok, true);
  assert.equal(result.engine.purchaseAuthority, false);
  assert.equal(result.boundary.soldFlag, false);
  assert.equal(facilitator.calls.settle, 1);

  const replay = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(deltaBody, { "payment-signature": payment }));
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 1);

  const drifted = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(
    { before: journeyBefore, after: journeyBefore },
    { "payment-signature": payment },
  ));
  assert.equal(drifted.status, 409);
  assert.equal((await drifted.json()).charged, false);
  assert.equal(facilitator.calls.settle, 1);

  const otherPayload = JSON.parse(Buffer.from(payment, "base64").toString("utf8"));
  otherPayload.payload.authorization.from = `0x${"a".repeat(40)}`;
  const driftedPayer = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(
    deltaBody,
    { "payment-signature": Buffer.from(JSON.stringify(otherPayload)).toString("base64") },
  ));
  assert.equal(driftedPayer.status, 409);
  assert.equal((await driftedPayer.json()).charged, false);
  assert.equal(facilitator.calls.settle, 1);

  const sameChallenge = decodePaymentRequired(
    await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost({ before: journeyBefore, after: journeyBefore })),
  );
  const samePayment = testPayment(sameChallenge, { id: "lockfile_same_1234567890ab" });
  const samePaid = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(
    { before: journeyBefore, after: journeyBefore },
    { "payment-signature": samePayment },
  ));
  const sameResult = await samePaid.json();
  assert.equal(samePaid.status, 200, JSON.stringify(sameResult));
  assertOutput(sameResult);
  assert.equal(sameResult.analysis, "informational");
  assert.equal(sameResult.ok, true);
  assert.equal(sameResult.engine.counts.changed, 0);

  const client = new Client({ name: "lockfile-on", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 23);
    const tool = tools.find((entry) => entry.name === "lockfile_pin_delta");
    assert.ok(tool);
    assert.match(tool.description, /https:\/\/agents\.samedaydesk\.com\/lockfile-pin-delta, not mcp:\/\//);
  } finally {
    await client.close();
  }

  const extractUnchanged = await fetch(`${merchant.base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(extractUnchanged.status, 402);
});

test("timeout after simulated payment is not informational no-change", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-timeout-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({
    dataDir,
    facilitatorUrl: facilitator.url,
    extraEnv: {
      LOCKFILE_PIN_DELTA_TIMEOUT_MS: "200",
      LOCKFILE_PIN_DELTA_WORKER_HOLD_MS: "2000",
    },
  });
  const body = { before: journeyBefore, after: journeyAfter };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(body)));
  const payment = testPayment(challenge, { id: "lockfile_timeout_1234567890" });
  const paid = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(body, { "payment-signature": payment }));
  const result = await paid.json();
  assert.equal(paid.status, 200, JSON.stringify(result));
  assert.equal(result.charged, true);
  assert.equal(result.ok, false);
  assert.equal(result.analysis, "not-run");
  assert.equal(result.transport, "timeout");
  assert.notEqual(result.analysis, "informational");
});

test("simulated facilitator verify failure does not settle", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-verify-"));
  const facilitator = await startFakeFacilitator({ verifyValid: false });
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const body = { before: journeyBefore, after: journeyAfter };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(body)));
  const rejected = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(body, {
    "payment-signature": testPayment(challenge, { id: "lockfile_verify_1234567890" }),
  }));
  assert.equal(rejected.status, 402);
  await rejected.text();
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 0);
});

test("lockfile flag does not disable production extract_batch", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-batch-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({
    dataDir,
    facilitatorUrl: facilitator.url,
    extraEnv: { EXTRACT_BATCH_ENABLED: "1" },
  });
  const deadline = Date.now() + 20_000;
  while (!merchant.output().includes("MCP server:  POST /mcp (24 paid tools)")) {
    if (Date.now() > deadline) throw new Error(`MCP mount timed out:\n${merchant.output().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const [openapi, catalog, batch, lockfile] = await Promise.all([
    fetch(`${merchant.base}/openapi.json`).then((r) => r.json()),
    fetch(`${merchant.base}/api/actions`).then((r) => r.json()),
    fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost({ urls: ["https://example.com/"] })),
    fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost({ before: journeyBefore, after: journeyAfter })),
  ]);
  assert.equal(openapi.paths[EXTRACT_BATCH_PATH].post.operationId, "extractPublicUrlsBatch");
  assert.equal(openapi.paths[LOCKFILE_PIN_DELTA_PATH].post.operationId, "compareLockfilePinDelta");
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 27);
  assert.equal(catalog.actions.some((action) => action.route === EXTRACT_BATCH_PATH), true);
  assert.equal(catalog.actions.some((action) => action.route === LOCKFILE_PIN_DELTA_PATH), true);
  assert.equal(batch.status, 402);
  assert.equal(lockfile.status, 402);
  assert.doesNotMatch(LOCKFILE_PIN_DELTA_QUOTE_MEANING, /D26|EC2/i);
  const client = new Client({ name: "lockfile-batch", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 24);
    assert.ok(tools.some((tool) => tool.name === "extract_batch"));
    assert.ok(tools.some((tool) => tool.name === "lockfile_pin_delta"));
  } finally {
    await client.close();
  }
});

test("unknown settlement is not retried", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lockfile-settle-"));
  const facilitator = await startFakeFacilitator({ settleSuccess: false });
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const body = { before: journeyBefore, after: journeyAfter };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(body)));
  const payment = testPayment(challenge, { id: "lockfile_settle_1234567890" });
  const paid = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.notEqual(paid.status, 500);
  await paid.text();
  assert.equal(facilitator.calls.settle, 1);
  const second = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.equal(facilitator.calls.settle, 1);
  assert.equal(second.status, 503);
  await second.text();
});
