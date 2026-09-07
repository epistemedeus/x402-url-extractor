import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { evm as evmClient, Mppx as ClientMppx } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { mppAssetForNetwork } from "./mpp-dual-stack.mjs";
import { EXTRACT_BATCH_AMOUNT_ATOMIC, EXTRACT_BATCH_PATH } from "./extract-batch-config.mjs";
import { extractBatchOutputSchema } from "./extract-batch.mjs";
const validateOutput = new Ajv2020({ strict: false, allErrors: true }).compile(extractBatchOutputSchema());
function assertOutput(result) {
  assert.equal(validateOutput(result), true, JSON.stringify(validateOutput.errors));
}

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PAYER = `0x${"2".repeat(40)}`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const MPP_SECRET = "test-secret-key-test-secret-key-32";
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

async function startFakeFacilitator({ settleSuccess = true, settleOnce = false, verifyValid = true } = {}) {
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
      return send(200, { isValid: verifyValid, invalidReason: verifyValid ? undefined : "invalid_signature", payer: PAYER });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      if (!settleSuccess || (settleOnce && calls.settle > 1)) {
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

async function startMerchant({
  dataDir,
  facilitatorUrl,
  enabled = true,
  extraEnv = {},
  fetchLogPath,
} = {}) {
  const preloadPath = path.join(dataDir, "extract-batch-fetch-hook.mjs");
  await writeFile(preloadPath, `
import { writeFileSync } from "node:fs";
const logPath = ${JSON.stringify(fetchLogPath || path.join(dataDir, "source-fetches.log"))};
const pages = {
  "https://alpha.example/": { status: 200, body: "<!doctype html><title>Alpha</title><h1>Alpha</h1>" },
  "https://beta.example/": { status: 200, body: "<!doctype html><title>Beta</title><script type=\\"application/ld+json\\">{nope}</script>" },
  "https://fail.example/": { status: 404, body: "missing" },
  "https://start.example/": { status: 302, location: "https://end.example/" },
  "https://end.example/": { status: 200, body: "<!doctype html><title>Redirected</title><h1>End</h1>" },
  "https://huge.example/": { status: 200, body: "x".repeat(5000) },
};
globalThis.__SAMEDAYDESK_EXTRACT_BATCH_FETCH__ = async (url) => {
  writeFileSync(logPath, url + "\\n", { flag: "a" });
  const page = pages[url];
  if (!page) {
    const err = new Error("unmapped source");
    err.code = "fetch_error";
    throw err;
  }
  if (page.location) {
    return {
      status: page.status,
      headers: { get: (name) => name.toLowerCase() === "location" ? page.location : null },
      body: { cancel: async () => {} },
    };
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
      EXTRACT_BATCH_ENABLED: enabled ? "1" : "0",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      NODE_OPTIONS: [existingNodeOptions, `--import=${pathToFileURL(preloadPath).href}`].filter(Boolean).join(" "),
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

function testPayment(challenge, { id = "batch_order_1234567890ab" } = {}) {
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
    extensions: { "payment-identifier": { info: { required: challenge.extensions?.["payment-identifier"]?.info?.required === true, id } } },
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

async function readFetchLog(filePath) {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(filePath, "utf8");
    return text.split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("flag off leaves live extract and catalogs unchanged", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-off-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: false, fetchLogPath });
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
  assert.equal(openapi.paths[EXTRACT_BATCH_PATH], undefined);
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 25);
  assert.equal(catalog.actions.length, 22);
  assert.equal(catalog.actions.some((action) => action.route === EXTRACT_BATCH_PATH), false);
  assert.equal(manifest.items.some((item) => item.resource?.routeTemplate === EXTRACT_BATCH_PATH), false);
  assert.equal(extract.status, 402);
  const missing = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost({ urls: ["https://alpha.example/"] }));
  assert.equal(missing.status, 404);
  const client = new Client({ name: "batch-off", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 22);
    assert.equal(tools.some((tool) => tool.name === "extract_batch"), false);
  } finally {
    await client.close();
  }
  assert.deepEqual(await readFetchLog(fetchLogPath), []);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);
});

test("invalid input is rejected before settlement and source fetch", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-invalid-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const unpaid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost({ urls: ["http://example.com/"] }));
  assert.equal(unpaid.status, 400);
  assert.equal((await unpaid.json()).charged, false);
  const challenge = decodePaymentRequired(
    await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost({ urls: ["https://alpha.example/"] })),
  );
  const paidInvalid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(
    { urls: ["https://127.0.0.1/"] },
    { "payment-signature": testPayment(challenge, { id: "batch_invalid_1234567890" }) },
  ));
  assert.equal(paidInvalid.status, 400);
  assert.equal((await paidInvalid.json()).charged, false);
  assert.deepEqual(await readFetchLog(fetchLogPath), []);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);
});

test("unpaid valid requests issue x402 and MPP challenges without fetching sources", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-unpaid-"));
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
  const response = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body));
  assert.equal(response.status, 402);
  const challenge = decodePaymentRequired(response);
  const accepted = challenge.accepts.find((entry) => entry.network === NETWORK && entry.scheme === "exact");
  assert.equal(accepted.amount, EXTRACT_BATCH_AMOUNT_ATOMIC);
  assert.equal(accepted.payTo, PAY_TO);
  assert.match(response.headers.get("www-authenticate") || "", /^Payment /);
  const validateBazaar = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(challenge.extensions.bazaar.schema);
  assert.equal(validateBazaar(challenge.extensions.bazaar.info), true, JSON.stringify(validateBazaar.errors));
  assert.deepEqual(await readFetchLog(fetchLogPath), []);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);

  const openapi = await fetch(`${merchant.base}/openapi.json`).then((r) => r.json());
  assert.equal(openapi.paths[EXTRACT_BATCH_PATH].post["x-payment-info"].price.amount, "0.01");
  assert.equal(openapi.paths[EXTRACT_BATCH_PATH].post.operationId, "extractPublicUrlsBatch");
  assert.equal(Object.values(openapi.paths).flatMap(Object.values).filter((op) => op?.["x-payment-info"]).length, 26);
  const mppOpenapi = await fetch(`${merchant.base}/mpp-openapi.json`).then((r) => r.json());
  assert.deepEqual(mppOpenapi.paths[EXTRACT_BATCH_PATH].post.requestBody, openapi.paths[EXTRACT_BATCH_PATH].post.requestBody);
  assert.deepEqual(mppOpenapi.paths[EXTRACT_BATCH_PATH].post.responses["200"], openapi.paths[EXTRACT_BATCH_PATH].post.responses["200"]);
  const manifest = await fetch(`${merchant.base}/.well-known/x402`).then((r) => r.json());
  assert.equal(manifest.items.some((item) => item.resource?.routeTemplate === EXTRACT_BATCH_PATH), true);
  const catalog = await fetch(`${merchant.base}/api/actions`).then((r) => r.json());
  const action = catalog.actions.find((entry) => entry.route === EXTRACT_BATCH_PATH);
  assert.ok(action);
  assert.equal(action.method, "POST");
  assert.equal(action.priceAtomicUsdc, EXTRACT_BATCH_AMOUNT_ATOMIC);
  assert.equal(action.request?.example?.bodyType, "json");
  assert.deepEqual(action.request?.example?.body?.urls, ["https://example.com/"]);
  assert.equal(Array.isArray(action.request?.example?.body?.fields), true);
});

test("flag on projects the batch offer across MCP tools/list with matching schemas", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-mcp-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: true });
  const deadline = Date.now() + 20_000;
  while (!merchant.output().includes("MCP server:  POST /mcp (23 paid tools)")) {
    if (Date.now() > deadline) throw new Error(`MCP mount timed out:\n${merchant.output().slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const client = new Client({ name: "batch-on", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  let tools;
  try {
    tools = (await client.listTools()).tools;
  } finally {
    await client.close();
  }
  assert.equal(tools.length, 23);
  const batch = tools.find((tool) => tool.name === "extract_batch");
  assert.ok(batch);
  assert.equal(batch.inputSchema?.properties?.urls?.type, "array");
  assert.equal(batch.outputSchema?.properties?.product?.const, "samedaydesk-extract-batch");
  assert.equal(batch.outputSchema?.required?.includes("staging"), false);
  assert.match(batch.description, /https:\/\/agents\.samedaydesk\.com\/extract\/batch, not mcp:\/\//);
  const catalog = await fetch(`${merchant.base}/api/actions`).then((r) => r.json());
  assert.equal(catalog.actions.length, 23);
  const effects = await fetch(`${merchant.base}/.well-known/paid-action-effects.json`).then((r) => r.json());
  assert.equal(effects.operations.some((op) => op.method === "POST" && op.path === EXTRACT_BATCH_PATH), true);
  const evidence = await fetch(`${merchant.base}/.well-known/agent-payment-evidence.json`).then((r) => r.json());
  assert.equal(evidence.operations.some((op) => op.method === "POST" && op.path === EXTRACT_BATCH_PATH), true);
});

test("malformed and oversized bodies stay uncharged across HTTP projections", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-malformed-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const cases = [
    ["https://alpha.example/"],
    { urls: "https://alpha.example/" },
    { urls: [{ href: "https://alpha.example/" }] },
    { urls: ["https://alpha.example/"], fields: "title" },
  ];
  for (const body of cases) {
    const response = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).charged, false);
  }
  const oversized = { urls: ["https://alpha.example/"], pad: "x".repeat(20_000) };
  const huge = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(oversized));
  assert.ok([400, 413].includes(huge.status), `unexpected status ${huge.status}`);
  assert.deepEqual(await readFetchLog(fetchLogPath), []);
  assert.equal(facilitator.calls.verify, 0);
  assert.equal(facilitator.calls.settle, 0);
});

test("x402 payment runs C1, returns partial facts, and binds the submitted body", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-x402-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const body = { urls: ["https://alpha.example/", "https://beta.example/", "https://fail.example/"], fields: ["title", "jsonLd"] };
  const challengeResponse = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body));
  const payment = testPayment(decodePaymentRequired(challengeResponse), { id: "batch_paid_1234567890abcd" });
  const paid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment }));
  const result = await paid.json();
  assert.equal(paid.status, 200, JSON.stringify(result));
  assertOutput(result);
  assert.equal(result.partial, true);
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[0].status, "success");
  assert.equal(result.sources[1].status, "partial");
  assert.equal(result.sources[2].status, "failure");
  assert.equal(result.quote.amountAtomic, EXTRACT_BATCH_AMOUNT_ATOMIC);
  assert.equal(result.costInputs.hostingCosts, "unknown");
  assert.equal(result.charged, true);
  const fetches = await readFetchLog(fetchLogPath);
  assert.deepEqual(fetches, ["https://alpha.example/", "https://beta.example/", "https://fail.example/"]);
  assert.equal(facilitator.calls.verify, 1);
  assert.equal(facilitator.calls.settle, 1);

  const replay = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 1);
  assert.equal((await readFetchLog(fetchLogPath)).length, 3);

  const drifted = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(
    { urls: ["https://alpha.example/"], fields: ["title"] },
    { "payment-signature": payment },
  ));
  assert.equal(drifted.status, 409);
  assert.equal((await drifted.json()).charged, false);
  assert.equal(facilitator.calls.settle, 1);
  assert.equal((await readFetchLog(fetchLogPath)).length, 3);

  const extractUnchanged = await fetch(`${merchant.base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(extractUnchanged.status, 402);
});

test("MPP unpaid challenge binds POST body and pays without a second source execution", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-mpp-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const body = { urls: ["https://start.example/"], fields: ["title"] };
  const unpaid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body));
  assert.equal(unpaid.status, 402);
  const authorization = await createMppCredential(unpaid);
  const paid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { authorization }));
  const result = await paid.json();
  assert.equal(paid.status, 200, JSON.stringify(result));
  assert.equal(result.sources[0].status, "success");
  assert.equal(result.sources[0].finalUrl, "https://end.example/");
  assertOutput(result);
  assert.equal((await readFetchLog(fetchLogPath)).length, 2);
  assert.equal(facilitator.calls.settle, 1);

  const [replayOne, replayTwo] = await Promise.all([
    fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { authorization })),
    fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { authorization })),
  ]);
  for (const replay of [replayOne, replayTwo]) {
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("x-payment-replay"), "hit");
    assert.deepEqual(await replay.json(), result);
  }
  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const resumed = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { authorization }));
  assert.equal(resumed.headers.get("x-payment-replay"), "hit");
  assert.deepEqual(await resumed.json(), result);

  const otherBody = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(
    { urls: ["https://alpha.example/"] },
    { authorization },
  ));
  assert.ok([402, 409].includes(otherBody.status), `changed MPP body returned ${otherBody.status}`);
  assert.equal((await otherBody.json()).charged, false);
  assert.equal(facilitator.calls.settle, 1);
  assert.equal((await readFetchLog(fetchLogPath)).length, 2);
});

test("unknown settlement is not retried inside one request; ceilings stop extra hops", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-unknown-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator({ settleSuccess: false });
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({
    dataDir,
    facilitatorUrl: facilitator.url,
    fetchLogPath,
    extraEnv: { EXTRACT_BATCH_MAX_BYTES_PER_ITEM: "64" },
  });
  const body = { urls: ["https://huge.example/"] };
  const challenge = decodePaymentRequired(
    await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body)),
  );
  const payment = testPayment(challenge, { id: "batch_unknown_1234567890" });
  const paid = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.notEqual(paid.status, 500);
  assert.equal(facilitator.calls.settle <= 1, true);
  const second = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, {
    "payment-signature": payment,
  }));
  assert.equal(facilitator.calls.settle, 1, "unknown settlement must not be attempted again");
  assert.equal((await readFetchLog(fetchLogPath)).length, 1, "unknown settlement must not fetch again");
  assert.equal(second.status, 503);
  await second.text();
  await paid.text();
  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
  const resumed = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment }));
  assert.equal(resumed.status, 503); await resumed.text();
  assert.equal(facilitator.calls.settle, 1);
  assert.equal((await readFetchLog(fetchLogPath)).length, 1);
});

test("existing default-on opportunity route preserves unknown settlement on retry", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "existing-extract-unknown-"));
  const facilitator = await startFakeFacilitator({ settleSuccess: false });
  let merchant;
  t.after(async () => { if (merchant) await stopChild(merchant.child); await facilitator.close(); await rm(dataDir, { recursive: true, force: true }); });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: false, extraEnv: { IDEMPOTENCY_INFLIGHT_WAIT_MS: "50" } });
  // Existing deterministic route needs no network or paid upstream call.
  const url = `${merchant.base}/work/opportunity-preflight?rewardUsd=10&hours=1&hourlyCostUsd=1`;
  const challenge = decodePaymentRequired(await fetch(url));
  const payment = testPayment(challenge, { id: "existing_unknown_1234567890" });
  await fetch(url, { headers: { "payment-signature": payment } }).then((r) => r.text());
  assert.equal(facilitator.calls.settle, 1);
  await fetch(url, { headers: { "payment-signature": payment } }).then((r) => r.text());
  assert.equal(facilitator.calls.settle, 1, "existing route must preserve possible spend");
});

test("existing default-on opportunity replay survives a server restart", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "existing-extract-restart-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => { if (merchant) await stopChild(merchant.child); await facilitator.close(); await rm(dataDir, { recursive: true, force: true }); });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: false });
  const route = "/work/opportunity-preflight?rewardUsd=10&hours=1&hourlyCostUsd=1";
  const headers = { host: "agents.samedaydesk.com" };
  const challenge = decodePaymentRequired(await fetch(`${merchant.base}${route}`, { headers }));
  headers["payment-signature"] = testPayment(challenge, { id: "existing_restart_1234567890" });
  const first = await fetch(`${merchant.base}${route}`, { headers });
  assert.equal(first.status, 200);
  await first.text();
  await stopChild(merchant.child);
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, enabled: false });
  const resumed = await fetch(`${merchant.base}${route}`, { headers });
  await resumed.text();
  assert.equal(resumed.headers.get("x-payment-replay"), "hit");
  assert.equal(facilitator.calls.settle, 1);
});

test("concurrent identical paid requests do not duplicate settlement or source execution", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-conc-"));
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
  const challenge = decodePaymentRequired(
    await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body)),
  );
  const payment = testPayment(challenge, { id: "batch_conc_1234567890abcd" });
  const [first, second] = await Promise.all([
    fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment })),
    fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, { "payment-signature": payment })),
  ]);
  assert.equal(first.status, 200);
  assert.ok([200, 503].includes(second.status), `concurrent twin returned ${second.status}`);
  assert.equal(facilitator.calls.settle, 1);
  assert.equal((await readFetchLog(fetchLogPath)).length, 1);
});

test("both real payment rails reject failed verification without any source reads", { timeout: 90_000 }, async (t) => {
  for (const rail of ["x402", "mpp"]) {
    const dataDir = await mkdtemp(path.join(tmpdir(), "extract-batch-denied-"));
    const fetchLogPath = path.join(dataDir, "source-fetches.log");
    const facilitator = await startFakeFacilitator({ verifyValid: false });
    let merchant;
    try {
      merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
      const body = { urls: ["https://alpha.example/"], fields: ["title"] };
      const challenge = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body));
      const headers = rail === "mpp"
        ? { authorization: await createMppCredential(challenge) }
        : { "payment-signature": testPayment(decodePaymentRequired(challenge)) };
      const rejected = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, jsonPost(body, headers));
      assert.equal(rejected.status, 402); await rejected.text();
      assert.equal(facilitator.calls.verify, 1);
      assert.equal(facilitator.calls.settle, 0);
      assert.deepEqual(await readFetchLog(fetchLogPath), []);
    } finally {
      if (merchant) await stopChild(merchant.child);
      await facilitator.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  }
});

async function mcpCall(base, body, payment, headers = {}) {
  const response = await fetch(`${base}/mcp`, { method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 77, method: "tools/call",
      params: { name: "extract_batch", arguments: body, ...(payment ? { _meta: { "x402/payment": payment } } : {}) } }),
  });
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(text.split("\n").find((line) => line.startsWith("data: ")).slice(6));
  }
  return JSON.parse(text);
}

test("mounted MCP same paid batch replays across restart without a second settlement", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "batch-mcp-replay-"));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => { if (merchant) await stopChild(merchant.child); await facilitator.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function start() {
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
    const deadline = Date.now() + 20000;
    while (!merchant.output().includes("MCP server:  POST /mcp (23 paid tools)")) {
      if (Date.now() > deadline) throw new Error(`MCP startup timeout: ${merchant.output().slice(-3000)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  await start();
  const body = { urls: ["https://alpha.example/"], fields: ["title"] };
  const unpaid = await mcpCall(merchant.base, body, null, { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http" });
  const challenge = unpaid.result?.structuredContent;
  assert.equal(challenge?.resource?.url, "https://agents.samedaydesk.com/extract/batch", JSON.stringify(unpaid));
  const payment = JSON.parse(Buffer.from(testPayment(challenge), "base64").toString());
  for (const url of ["mcp://samedaydesk/extract_batch", "https://attacker.example/extract/batch", "https://agents.samedaydesk.com/extract"]) {
    const denied = await mcpCall(merchant.base, body, { ...payment, resource: { ...payment.resource, url } });
    assert.equal(denied.result?.isError, true);
  }
  assert.equal(facilitator.calls.verify, 0);
  assert.equal((await readFetchLog(fetchLogPath)).length, 0);
  const first = await mcpCall(merchant.base, body, payment);
  assert.equal(first.result?.structuredContent?.sources?.[0]?.data?.title, "Alpha", JSON.stringify(first));
  assertOutput(first.result.structuredContent);
  await stopChild(merchant.child); await start();
  const replay = await mcpCall(merchant.base, body, payment);
  assert.equal(facilitator.calls.settle, 1, "MCP must reuse the existing POST replay boundary");
  assert.deepEqual(replay.result?.structuredContent, first.result.structuredContent);
  assert.equal((await readFetchLog(fetchLogPath)).length, 1);
  const mppBody = { urls: ["https://beta.example/"], fields: ["title"] };
  const mppChallenge = await mcpCall(merchant.base, mppBody);
  const credential = await createMppCredential(new Response(JSON.stringify(mppChallenge.result.structuredContent), {
    status: 402, headers: mppChallenge.result._meta["samedaydesk/http"].headers,
  }));
  const mppPaid = await mcpCall(merchant.base, mppBody, null, { authorization: credential });
  assert.equal(mppPaid.result?.structuredContent?.sources?.[0]?.data?.title, "Beta", JSON.stringify(mppPaid));
  await stopChild(merchant.child); await start();
  const mppReplay = await mcpCall(merchant.base, mppBody, null, { authorization: credential });
  assert.deepEqual(mppReplay.result.structuredContent, mppPaid.result.structuredContent);
  assert.equal(facilitator.calls.settle, 2);
  assert.equal((await readFetchLog(fetchLogPath)).length, 2);
});

for (const protocol of ["x402", "mpp"]) for (const mode of ["denied", "unknown"]) test(`mounted MCP ${protocol} ${mode} authorization does not repeat work or settlement`, { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), `batch-mcp-${mode}-`));
  const fetchLogPath = path.join(dataDir, "source-fetches.log");
  const facilitator = await startFakeFacilitator({ verifyValid: mode !== "denied", settleSuccess: mode !== "unknown" });
  let merchant;
  t.after(async () => { if (merchant) await stopChild(merchant.child); await facilitator.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function start() {
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url, fetchLogPath });
    const deadline = Date.now() + 20000;
    while (!merchant.output().includes("MCP server:  POST /mcp (23 paid tools)")) {
      if (Date.now() > deadline) throw new Error("MCP startup timeout");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  await start();
  const body = { urls: ["https://alpha.example/"], fields: ["title"] };
  const unpaid = await mcpCall(merchant.base, body);
  const payment = JSON.parse(Buffer.from(testPayment(unpaid.result.structuredContent), "base64").toString());
  const credential = protocol === "mpp" ? await createMppCredential(new Response(JSON.stringify(unpaid.result.structuredContent), {
    status: 402, headers: unpaid.result._meta["samedaydesk/http"].headers,
  })) : null;
  const callPaid = () => mcpCall(merchant.base, body, protocol === "x402" ? payment : null,
    credential ? { authorization: credential } : {});
  for (const invalid of [{ urls: ["https://127.0.0.1/"] }, { ...body, fields: ["unsupported"] }, { ...body, extra: true }]) {
    const result = await mcpCall(merchant.base, invalid, payment);
    assert.ok(result.error || result.result?.isError);
  }
  assert.equal(facilitator.calls.verify, 0);
  const deniedMpp = await mcpCall(merchant.base, body, null, { authorization: "Payment invalid" });
  assert.equal(deniedMpp.result?.isError, true);
  assert.equal((await readFetchLog(fetchLogPath)).length, 0);
  const first = await callPaid();
  assert.equal(first.result?.isError, true);
  await callPaid();
  await stopChild(merchant.child); await start();
  const resumed = await callPaid();
  assert.equal(resumed.result?.isError, true);
  assert.equal(facilitator.calls.settle, mode === "unknown" ? 1 : 0);
  assert.equal((await readFetchLog(fetchLogPath)).length, mode === "unknown" && protocol === "x402" ? 1 : 0);
});
