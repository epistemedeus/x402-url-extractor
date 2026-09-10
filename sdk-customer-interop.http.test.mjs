import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PAYMENT_IDENTIFIER } from "@x402/extensions/payment-identifier";
import { ExactEvmScheme } from "@x402/evm";
import { x402Client } from "@x402/fetch";
import { evm as evmClient, Mppx as ClientMppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

import { EXTRACT_BATCH_AMOUNT_ATOMIC, EXTRACT_BATCH_PATH } from "./extract-batch-config.mjs";
import { mppAssetForNetwork } from "./mpp-dual-stack.mjs";
import {
  runAuthorizedPurchase,
} from "./examples/customer-x402/src/purchase.mjs";
import {
  DEFAULT_AUTHORIZATION,
  DEFAULT_BATCH_AUTHORIZATION,
  LIVE_EXTRACT_BATCH_URL,
  LIVE_EXTRACT_URL,
  LIVE_NETWORK,
  OUTCOMES,
} from "./examples/customer-x402/src/constants.mjs";
import { normalizeAuthorization } from "./examples/customer-x402/src/authorization.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
const BUYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const buyer = privateKeyToAccount(BUYER_KEY);
// Negative control belongs only in the test, not the copyable customer client.
function createBaselineExactClientWithoutPaymentIdentifier({ network, signer }) {
  return new x402Client().register(network, new ExactEvmScheme(signer));
}
const mppAccount = privateKeyToAccount(
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

async function startFakeFacilitator() {
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
      return send(200, { isValid: true, payer: buyer.address });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(200, {
        success: true,
        payer: buyer.address,
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

async function startMerchant({ dataDir, facilitatorUrl, fetchLogPath }) {
  const preloadPath = path.join(dataDir, "sdk-interop-fetch-hook.mjs");
  await writeFile(preloadPath, `
import { writeFileSync } from "node:fs";
const logPath = ${JSON.stringify(fetchLogPath)};
const pages = {
  "https://example.com/": { status: 200, body: "<!doctype html><title>Example Domain</title><h1>Example Domain</h1><p>docs</p>" },
  "https://example.org/": { status: 200, body: "<!doctype html><title>Example Org</title><h1>Example Org</h1>" },
  "https://alpha.example/": { status: 200, body: "<!doctype html><title>Alpha</title><h1>Alpha</h1>" },
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const page = pages[url.href];
  if (page) {
    writeFileSync(logPath, url.href + "\\n", { flag: "a" });
    return new Response(page.body, { status: page.status, headers: { "content-type": "text/html" } });
  }
  if (url.origin === ${JSON.stringify(facilitatorUrl)}) return nativeFetch(input, init);
  throw new Error("unexpected SDK integration outbound request: " + url.origin);
};
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = globalThis.fetch;
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
      EXTRACT_BATCH_ENABLED: "1",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try { await new Promise((resolve, reject) => {
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
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  }); } catch (error) {
    await stopChild(child);
    throw error;
  }
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
      req.setTimeout(15_000, () => req.destroy(new Error("local merchant request timed out")));
      if (body) req.write(body);
      req.end();
    });
  };
}

function decodePaymentRequired(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "challenge omitted payment-required");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function paymentHeaderHasIdentifier(header) {
  const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const id = payload?.extensions?.[PAYMENT_IDENTIFIER]?.info?.id;
  return typeof id === "string" && id.length >= 16;
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

async function mcpCall(base, body) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 77,
      method: "tools/call",
      params: { name: "extract_batch", arguments: body },
    }),
  });
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6));
  }
  return JSON.parse(text);
}

test("seller free discovery declares payment-identifier required only on batch", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sdk-interop-discovery-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const proxy = proxyToMerchant(merchant.base);

  const batchUnpaid = await proxy(LIVE_EXTRACT_BATCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ urls: ["https://example.com/"], fields: ["title"] }),
  });
  assert.equal(batchUnpaid.status, 402);
  const batchChallenge = decodePaymentRequired(batchUnpaid);
  assert.equal(batchChallenge.extensions?.[PAYMENT_IDENTIFIER]?.info?.required, true);

  const getUnpaid = await proxy(LIVE_EXTRACT_URL, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  assert.equal(getUnpaid.status, 402);
  const getChallenge = decodePaymentRequired(getUnpaid);
  assert.equal(getChallenge.extensions?.[PAYMENT_IDENTIFIER]?.info?.required, false);

  const wellKnown = await fetch(`${merchant.base}/.well-known/x402`).then((r) => r.json());
  assert.equal(wellKnown.items.some((item) => item.resource?.routeTemplate === EXTRACT_BATCH_PATH), true);
});

test("negative control: official ExactEvmScheme without payment-identifier fails batch; repaired customer client succeeds", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sdk-interop-neg-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const proxy = proxyToMerchant(merchant.base);
  const auth = normalizeAuthorization({
    ...DEFAULT_BATCH_AUTHORIZATION,
    body: { urls: ["https://example.com/", "https://example.org/"], fields: ["title"] },
  });

  const unpaid = await proxy(auth.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: auth.bodyRaw,
  });
  assert.equal(unpaid.status, 402);
  const challenge = decodePaymentRequired(unpaid);
  assert.equal(challenge.extensions?.[PAYMENT_IDENTIFIER]?.info?.required, true);

  // Baseline composition that missed the live C22 path: ExactEvmScheme only.
  const baselineClient = createBaselineExactClientWithoutPaymentIdentifier({
    network: LIVE_NETWORK,
    signer: {
      address: buyer.address,
      signTypedData: (value) => buyer.signTypedData(value),
    },
  });
  const baselinePayload = await baselineClient.createPaymentPayload(challenge);
  assert.equal(baselinePayload.extensions?.[PAYMENT_IDENTIFIER]?.info?.id, undefined);
  const baselineHeader = Buffer.from(JSON.stringify(baselinePayload)).toString("base64");
  const baselinePaid = await proxy(auth.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "payment-signature": baselineHeader,
    },
    body: auth.bodyRaw,
  });
  assert.equal(baselinePaid.status, 400);
  assert.deepEqual(await baselinePaid.json(), {
    ok: false,
    error: "payment_identifier_required",
    charged: false,
  });
  assert.equal(baselinePaid.headers.get("payment-response"), null);
  assert.equal(facilitator.calls.settle, 0);
  assert.equal(facilitator.calls.verify, 0);

  let paymentHeaders = 0;
  let paidBodies = [];
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const bodyText = request.method === "POST" ? await request.clone().text() : null;
    const header = request.headers.get("payment-signature");
    if (header) {
      paymentHeaders += 1;
      assert.equal(paymentHeaderHasIdentifier(header), true);
      paidBodies.push(bodyText);
    }
    return proxy(request);
  };

  const result = await runAuthorizedPurchase({
    authorization: auth,
    account: buyer,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.USEFUL_DELIVERED, JSON.stringify(result));
  assert.equal(result.paymentSigned, true);
  assert.equal(result.paymentSent, true);
  assert.equal(paymentHeaders, 1);
  assert.equal(paidBodies.length, 1);
  assert.equal(paidBodies[0], auth.bodyRaw);
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 1);
  assert.equal(EXTRACT_BATCH_AMOUNT_ATOMIC, "10000");
});

test("repaired customer client batch purchase replays without extra settle or source fetch", { timeout: 120_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sdk-interop-replay-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const proxy = proxyToMerchant(merchant.base);
  const auth = normalizeAuthorization({
    ...DEFAULT_BATCH_AUTHORIZATION,
    body: { urls: ["https://alpha.example/"], fields: ["title"] },
  });

  let capturedPayment = null;
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const header = request.headers.get("payment-signature");
    if (header) capturedPayment = header;
    return proxy(request);
  };

  const first = await runAuthorizedPurchase({
    authorization: auth,
    account: buyer,
    fetchImpl,
    approve: true,
  });
  assert.equal(first.outcome, OUTCOMES.USEFUL_DELIVERED, JSON.stringify(first));
  assert.ok(capturedPayment);
  assert.equal(paymentHeaderHasIdentifier(capturedPayment), true);
  assert.equal(facilitator.calls.settle, 1);

  const { readFile } = await import("node:fs/promises");
  const fetchesAfterFirst = (await readFile(fetchLogPath, "utf8")).trim().split("\n").filter(Boolean);
  assert.deepEqual(fetchesAfterFirst, ["https://alpha.example/"]);

  const replay = await proxy(auth.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "payment-signature": capturedPayment,
    },
    body: auth.bodyRaw,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 1);
  const fetchesAfterReplay = (await readFile(fetchLogPath, "utf8")).trim().split("\n").filter(Boolean);
  assert.deepEqual(fetchesAfterReplay, ["https://alpha.example/"]);

  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const resumed = await proxyToMerchant(merchant.base)(auth.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "payment-signature": capturedPayment,
    },
    body: auth.bodyRaw,
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 1);
});

test("stock x402 GET still pays with optional payment-identifier enrichment", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sdk-interop-get-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const proxy = proxyToMerchant(merchant.base);
  let sawIdentifier = false;
  const fetchImpl = async (input, init) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init);
    const header = request.headers.get("payment-signature");
    if (header) sawIdentifier = paymentHeaderHasIdentifier(header);
    return proxy(request);
  };
  const result = await runAuthorizedPurchase({
    authorization: DEFAULT_AUTHORIZATION,
    account: buyer,
    fetchImpl,
    approve: true,
  });
  assert.equal(result.outcome, OUTCOMES.VALID_DELIVERED, JSON.stringify(result));
  assert.equal(result.evidence.outputValid, true);
  assert.equal(result.evidence.outputDelivery, "useful");
  assert.equal(result.evidence.retainedBody.title, "Example Domain");
  assert.equal(result.paymentSent, true);
  assert.equal(sawIdentifier, true);
  assert.equal(facilitator.calls.settle, 1);
});

test("native MPP batch remains payable without x402 payment-identifier flag", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sdk-interop-mpp-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const body = { urls: ["https://alpha.example/"], fields: ["title"] };
  const unpaid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(unpaid.status, 402);
  const authorization = await createMppCredential(unpaid);
  const paid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify(body),
  });
  const result = await paid.json();
  assert.equal(paid.status, 200, JSON.stringify(result));
  assert.equal(result.charged, true);
  assert.equal(facilitator.calls.settle, 1);
});

test("MCP extract_batch challenge projects required payment-identifier", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "sdk-interop-mcp-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const deadline = Date.now() + 20_000;
  while (!merchant.output().includes("MCP server:  POST /mcp (23 paid tools)")) {
    if (Date.now() > deadline) throw new Error(`MCP mount timed out:\n${merchant.output().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const unpaid = await mcpCall(merchant.base, { urls: ["https://alpha.example/"], fields: ["title"] });
  const challenge = unpaid.result?.structuredContent;
  assert.equal(challenge?.x402Version, 2, JSON.stringify(unpaid));
  assert.equal(challenge.extensions?.[PAYMENT_IDENTIFIER]?.info?.required, true);
  assert.ok(unpaid.result?._meta?.["samedaydesk/http"]?.headers?.["payment-required"]
    || unpaid.result?._meta?.["samedaydesk/http"]?.headers?.["PAYMENT-REQUIRED"]);
});
