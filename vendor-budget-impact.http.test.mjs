import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
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
import { wrapFetchWithPayment } from "@x402/fetch";
import { evm as evmClient, Mppx as ClientMppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

import { EXTRACT_BATCH_PATH } from "./extract-batch-config.mjs";
import {
  VENDOR_BUDGET_IMPACT_AMOUNT_ATOMIC,
  VENDOR_BUDGET_IMPACT_PATH,
  VENDOR_BUDGET_IMPACT_PRICE_USD,
  VENDOR_BUDGET_IMPACT_QUOTE_MEANING,
} from "./vendor-budget-impact-config.mjs";
import { vendorBudgetImpactOutputSchema } from "./vendor-budget-impact.mjs";
import { createCustomerX402Client } from "./examples/customer-x402/src/purchase.mjs";
import { mppAssetForNetwork } from "./mpp-dual-stack.mjs";

const validateOutput = new Ajv2020({ strict: false, allErrors: true }).compile(vendorBudgetImpactOutputSchema());
function assertOutput(result) {
  assert.equal(validateOutput(result), true, JSON.stringify(validateOutput.errors));
}

const cwd = path.dirname(fileURLToPath(import.meta.url));
const SYNTH_PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const BUYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const buyer = privateKeyToAccount(BUYER_KEY);
const mppAccount = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const PAID_EVIDENCE_RESPONSE_DOMAIN = "samedaydesk.commerce-paid-success-evidence.response.v1\0";
const callerBefore = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/caller-before.json"), "utf8"));
const callerAfter = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/caller-after.json"), "utf8"));
const callerNochange = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/caller-after-nochange.json"), "utf8"));
const callerPrice = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/caller-after-price.json"), "utf8"));
const unitBefore = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/unit-before.json"), "utf8"));
const unitAfter = JSON.parse(readFileSync(path.join(cwd, "fixtures/vendor-budget-impact/unit-after.json"), "utf8"));

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

async function startFakeFacilitator({ settleSuccess = true, verifyValid = true, payer = SYNTH_PAYER } = {}) {
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
      return send(200, { isValid: verifyValid, invalidReason: verifyValid ? undefined : "invalid_signature", payer });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      if (!settleSuccess) return send(200, { success: false, errorReason: "unknown_settlement", transaction: "", network: NETWORK });
      return send(200, { success: true, payer, transaction: `0x${"3".repeat(64)}`, network: NETWORK });
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
      VENDOR_BUDGET_IMPACT_ENABLED: enabled ? "1" : "0",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
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

function testPayment(challenge, { id = "vendor_budget_order_1234", from = SYNTH_PAYER } = {}) {
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
        from,
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

function proxyToMerchant(merchantBase) {
  const origin = new URL(merchantBase);
  return async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const publicUrl = new URL(request.url);
    if (publicUrl.hostname !== "agents.samedaydesk.com") {
      throw new Error("unexpected public client target: " + publicUrl.origin);
    }
    const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
    const headers = Object.fromEntries(request.headers.entries());
    headers.host = publicUrl.host;
    headers["x-forwarded-host"] = publicUrl.host;
    headers["x-forwarded-proto"] = "https";
    if (body) headers["content-length"] = String(body.length);
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: origin.hostname,
        port: origin.port,
        path: `${publicUrl.pathname}${publicUrl.search}`,
        method: request.method,
        headers,
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value == null) continue;
            if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(name, entry));
            else responseHeaders.set(name, value);
          }
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode || 500,
            headers: responseHeaders,
          }));
        });
      });
      req.on("error", reject);
      req.setTimeout(20_000, () => req.destroy(new Error("local merchant request timed out")));
      if (body) req.write(body);
      req.end();
    });
  };
}

async function paidWithOfficialFetch(merchantBase, body) {
  const client = createCustomerX402Client({
    network: NETWORK,
    signer: {
      address: buyer.address,
      signTypedData: (value) => buyer.signTypedData(value),
    },
  });
  const transport = wrapFetchWithPayment(proxyToMerchant(merchantBase), client);
  return transport(`https://agents.samedaydesk.com${VENDOR_BUDGET_IMPACT_PATH}`, {
    method: "POST",
    redirect: "error",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForPaidEvidence(dataDir, { timeoutMs = 8_000 } = {}) {
  const file = path.join(dataDir, "commerce-paid-success-evidence.ndjson");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = await readFile(file, "utf8");
      const rows = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const hit = rows.find((row) => row.route === VENDOR_BUDGET_IMPACT_PATH || row.resource === VENDOR_BUDGET_IMPACT_PATH);
      if (hit) return hit;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("paid-success evidence was not written");
}

async function createMppCredential(response) {
  const client = ClientMppx.create({
    methods: [evmClient({
      account: mppAccount,
      currencies: [mppAssetForNetwork(NETWORK)],
      maxAmount: "0.01",
    })],
    polyfill: false,
  });
  return client.createCredential(response);
}

test("flag off leaves live extract and catalogs unchanged", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-off-"));
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
  assert.equal(openapi.paths[VENDOR_BUDGET_IMPACT_PATH], undefined);
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 25);
  assert.equal(catalog.actions.some((action) => action.route === VENDOR_BUDGET_IMPACT_PATH), false);
  assert.equal(manifest.items.some((item) => item.resource?.routeTemplate === VENDOR_BUDGET_IMPACT_PATH), false);
  assert.equal(extract.status, 402);
  const missing = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({ before: callerBefore, after: callerAfter }));
  assert.equal(missing.status, 404);
  const healthz = await fetch(`${merchant.base}/healthz`).then((r) => r.json());
  assert.equal(Object.hasOwn(healthz.prices, "vendor-budget-impact"), false);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);
});

test("unsigned empty POSTs return 402; nonempty invalid probes refuse without facilitator calls", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-probe-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  const empty = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, { method: "POST" });
  assert.equal(empty.status, 402);
  assert.equal(empty.headers.get("payment-required") != null, true);
  const emptyChallenge = decodePaymentRequired(empty);
  const emptyAccepted = emptyChallenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(emptyAccepted.amount, VENDOR_BUDGET_IMPACT_AMOUNT_ATOMIC);
  assert.equal(emptyAccepted.payTo, PAY_TO);
  const emptyInput = emptyAccepted.outputSchema?.input || emptyChallenge.extensions?.bazaar?.info?.input;
  assert.equal(emptyInput?.method, "POST");
  assert.ok(emptyInput?.body?.before && emptyInput?.body?.after);
  assert.doesNotMatch(empty.headers.get("www-authenticate") || "", /^Payment /);

  const blank = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({}));
  assert.equal(blank.status, 402);

  for (const invalid of [null, [], { url: "https://example.test" }, { command: "node bin.js" }, { before: callerBefore }]) {
    const refused = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(invalid));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).charged, false);
  }

  const paidEmpty = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(
    {},
    { "payment-signature": testPayment(decodePaymentRequired(blank), { id: "vendor_empty_paid_123456" }) },
  ));
  assert.equal(paidEmpty.status, 400);
  assert.equal((await paidEmpty.json()).charged, false);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const officialMissing = await paidWithOfficialFetch(merchant.base, { before: callerBefore });
  assert.equal(officialMissing.status, 400);
  assert.equal((await officialMissing.json()).charged, false);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);
});

test("official @x402/fetch buys a useful delta; no-change and unit-change stay distinct; telemetry matches bytes", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-on-"));
  const facilitator = await startFakeFacilitator({ payer: buyer.address });
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

  const html = await readFile(path.join(cwd, "fixtures/vendor-budget-impact/unsupported-page.html"), "utf8");
  const unpaidInvalid = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({ before: html, after: callerAfter }));
  assert.equal(unpaidInvalid.status, 400);
  assert.equal((await unpaidInvalid.json()).charged, false);

  const pathBody = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({ before: "./prices.json", after: callerAfter }));
  assert.equal(pathBody.status, 400);
  assert.equal((await pathBody.json()).code, "filesystem_input");

  const oversized = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({
    before: { ...callerBefore, rows: Array.from({ length: 300 }, (_, i) => ({ field: `f${i}`, value: i, unit: "USD" })) },
    after: callerAfter,
  }));
  assert.ok([400, 413].includes(oversized.status), `unexpected oversize status ${oversized.status}`);
  assert.equal((await oversized.json()).charged, false);

  const openapi = await fetch(`${merchant.base}/openapi.json`).then((r) => r.json());
  assert.equal(openapi.paths[VENDOR_BUDGET_IMPACT_PATH].post.operationId, "compareVendorBudgetImpact");
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 26);
  const vendorProtocols = (openapi.paths[VENDOR_BUDGET_IMPACT_PATH].post["x-payment-info"]?.protocols || [])
    .flatMap((entry) => Object.keys(entry || {}));
  assert.deepEqual(vendorProtocols, ["x402"]);
  const mppOpenapi = await fetch(`${merchant.base}/mpp-openapi.json`).then((r) => r.json());
  assert.equal(mppOpenapi.paths[VENDOR_BUDGET_IMPACT_PATH], undefined);

  const paid = await paidWithOfficialFetch(merchant.base, { before: callerBefore, after: callerAfter });
  const paidText = await paid.text();
  const result = JSON.parse(paidText);
  assert.equal(paid.status, 200, paidText);
  assertOutput(result);
  assert.equal(result.analysis, "actionable");
  assert.equal(result.charged, true);
  assert.equal(result.ok, true);
  assert.equal(result.engine.purchaseAuthority, false);
  assert.equal(result.boundary.soldFlag, false);
  const inputChange = result.engine.fieldChanges.find((row) => row.fieldKey === "desk-chat-input");
  assert.equal(inputChange.beforeValue, 1);
  assert.equal(inputChange.afterValue, 1.5);
  assert.ok(result.engine.added.some((row) => row.fieldKey === "desk-embed"));
  assert.equal(facilitator.calls.settle >= 1, true);
  const settleAfterUseful = facilitator.calls.settle;

  const expectedDigest = createHash("sha256")
    .update(PAID_EVIDENCE_RESPONSE_DOMAIN, "utf8")
    .update(paidText)
    .digest("hex");
  const evidence = await waitForPaidEvidence(dataDir);
  assert.equal(evidence.responseDigest, expectedDigest);
  assert.equal(evidence.responseByteLength ?? Buffer.byteLength(paidText), Buffer.byteLength(paidText));

  const nochange = await paidWithOfficialFetch(merchant.base, { before: callerBefore, after: callerNochange });
  const nochangeResult = await nochange.json();
  assert.equal(nochange.status, 200, JSON.stringify(nochangeResult));
  assertOutput(nochangeResult);
  assert.equal(nochangeResult.analysis, "informational");
  assert.equal(nochangeResult.engine.counts.fieldChanges, 0);

  const price = await paidWithOfficialFetch(merchant.base, { before: callerBefore, after: callerPrice });
  const priceResult = await price.json();
  assert.equal(price.status, 200, JSON.stringify(priceResult));
  const priceChange = priceResult.engine.fieldChanges.find((row) => row.fieldKey === "desk-chat-input");
  assert.equal(priceChange.afterValue, 2.5);
  assert.notEqual(priceChange.afterValue, inputChange.afterValue);

  const units = await paidWithOfficialFetch(merchant.base, { before: unitBefore, after: unitAfter });
  const unitResult = await units.json();
  assert.equal(units.status, 200, JSON.stringify(unitResult));
  assert.equal(unitResult.analysis, "partial");
  assert.equal(unitResult.engine.counts.unitChanges, 1);

  const synthFacilitator = facilitator;
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({ before: callerBefore, after: callerAfter })));
  const payment = testPayment(challenge, { id: "vendor_replay_1234567890ab", from: buyer.address });
  const first = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({ before: callerBefore, after: callerAfter }, { "payment-signature": payment }));
  assert.equal(first.status, 200);
  const settleBeforeReplay = synthFacilitator.calls.settle;
  const replay = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({ before: callerBefore, after: callerAfter }, { "payment-signature": payment }));
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(synthFacilitator.calls.settle, settleBeforeReplay);

  const drifted = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(
    { before: callerBefore, after: callerNochange },
    { "payment-signature": payment },
  ));
  assert.equal(drifted.status, 409);
  assert.equal((await drifted.json()).charged, false);
  assert.equal(synthFacilitator.calls.settle, settleBeforeReplay);

  const client = new Client({ name: "vendor-budget-on", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 23);
    const tool = tools.find((entry) => entry.name === "vendor_budget_impact");
    assert.ok(tool);
    assert.match(tool.description, /https:\/\/agents\.samedaydesk\.com\/vendor-budget-impact, not mcp:\/\//);
  } finally {
    await client.close();
  }

  const extractUnchanged = await fetch(`${merchant.base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(extractUnchanged.status, 402);
  assert.equal(VENDOR_BUDGET_IMPACT_PRICE_USD, "$0.005");
  assert.doesNotMatch(VENDOR_BUDGET_IMPACT_QUOTE_MEANING, /D26|EC2/i);
  assert.ok(settleAfterUseful >= 1);
});

test("two simultaneous distinct callers stay isolated", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-parallel-"));
  const facilitator = await startFakeFacilitator({ payer: buyer.address });
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const [delta, same] = await Promise.all([
    paidWithOfficialFetch(merchant.base, { before: callerBefore, after: callerAfter }),
    paidWithOfficialFetch(merchant.base, { before: callerBefore, after: callerNochange }),
  ]);
  const deltaResult = await delta.json();
  const sameResult = await same.json();
  assert.equal(delta.status, 200, JSON.stringify(deltaResult));
  assert.equal(same.status, 200, JSON.stringify(sameResult));
  assert.equal(deltaResult.analysis, "actionable");
  assert.equal(sameResult.analysis, "informational");
  assert.notEqual(deltaResult.digest, sameResult.digest);
  assert.equal(facilitator.calls.settle, 2);
});

test("timeout after simulated payment is not informational no-change", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-timeout-"));
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
      VENDOR_BUDGET_IMPACT_TIMEOUT_MS: "200",
      VENDOR_BUDGET_IMPACT_WORKER_HOLD_MS: "2000",
    },
  });
  const body = { before: callerBefore, after: callerAfter };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body)));
  const payment = testPayment(challenge, { id: "vendor_timeout_1234567890" });
  const paid = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body, { "payment-signature": payment }));
  const result = await paid.json();
  assert.equal(paid.status, 503, JSON.stringify(result));
  assert.equal(result.charged, false);
  assert.equal(result.analysis, "not-run");
  assert.equal(result.transport, "timeout");
  assert.equal(facilitator.calls.settle, 0);

  const retry = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body, { "payment-signature": payment }));
  const retryBody = await retry.json();
  assert.equal(retry.status, 503, JSON.stringify(retryBody));
  assert.notEqual(retry.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 0);
});

test("simulated facilitator verify failure does not settle", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-verify-"));
  const facilitator = await startFakeFacilitator({ verifyValid: false });
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const body = { before: callerBefore, after: callerAfter };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body)));
  const rejected = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body, {
    "payment-signature": testPayment(challenge, { id: "vendor_verify_1234567890" }),
  }));
  assert.equal(rejected.status, 402);
  await rejected.text();
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 0);
});

test("x402 worker crash is HTTP 503 and does not settle", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-crash-"));
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
    extraEnv: { VENDOR_BUDGET_IMPACT_WORKER_CRASH: "1" },
  });
  const body = { before: callerBefore, after: callerAfter };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body)));
  const payment = testPayment(challenge, { id: "vendor_crash_1234567890ab" });
  const paid = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body, { "payment-signature": payment }));
  const result = await paid.json();
  assert.equal(paid.status, 503, JSON.stringify(result));
  assert.equal(result.charged, false);
  assert.equal(result.analysis, "not-run");
  assert.equal(result.transport, "engine-crash");
  assert.equal(facilitator.calls.settle, 0);
});

test("supplied MPP credential is refused before settlement", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-mpp-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const extractUnpaid = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://example.com")}`);
  assert.equal(extractUnpaid.status, 402);
  const authorization = await createMppCredential(extractUnpaid);
  const refused = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(
    { before: callerBefore, after: callerAfter },
    { authorization },
  ));
  const body = await refused.json();
  assert.equal(refused.status, 400, JSON.stringify(body));
  assert.equal(body.charged, false);
  assert.equal(body.code, "mpp_not_accepted");
  assert.equal(facilitator.calls.settle, 0);
});

test("vendor-budget flag does not disable production extract_batch", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-batch-"));
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
  const [openapi, catalog, batch, vendor] = await Promise.all([
    fetch(`${merchant.base}/openapi.json`).then((r) => r.json()),
    fetch(`${merchant.base}/api/actions`).then((r) => r.json()),
    fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost({ urls: ["https://example.com/"] })),
    fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost({ before: callerBefore, after: callerAfter })),
  ]);
  assert.equal(openapi.paths[EXTRACT_BATCH_PATH].post.operationId, "extractPublicUrlsBatch");
  assert.equal(openapi.paths[VENDOR_BUDGET_IMPACT_PATH].post.operationId, "compareVendorBudgetImpact");
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 27);
  assert.equal(catalog.actions.some((action) => action.route === EXTRACT_BATCH_PATH), true);
  assert.equal(catalog.actions.some((action) => action.route === VENDOR_BUDGET_IMPACT_PATH), true);
  assert.equal(batch.status, 402);
  assert.match(batch.headers.get("www-authenticate") || "", /^Payment /);
  assert.equal(vendor.status, 402);
  assert.doesNotMatch(vendor.headers.get("www-authenticate") || "", /^Payment /);
  const mppOpenapi = await fetch(`${merchant.base}/mpp-openapi.json`).then((r) => r.json());
  assert.ok(mppOpenapi.paths[EXTRACT_BATCH_PATH]);
  assert.equal(mppOpenapi.paths[VENDOR_BUDGET_IMPACT_PATH], undefined);
});

test("unknown settlement is not retried", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vendor-budget-settle-"));
  const facilitator = await startFakeFacilitator({ settleSuccess: false });
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const body = { before: callerBefore, after: callerAfter };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body)));
  const payment = testPayment(challenge, { id: "vendor_settle_1234567890" });
  const paid = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.notEqual(paid.status, 500);
  await paid.text();
  assert.equal(facilitator.calls.settle, 1);
  const second = await fetch(`${merchant.base}${VENDOR_BUDGET_IMPACT_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.equal(facilitator.calls.settle, 1);
  assert.equal(second.status, 503);
  await second.text();
});
