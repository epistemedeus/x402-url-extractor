import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

import { assertExtractDiscoveryInventory } from "./extract-discovery-inventory.mjs";
import { EXTRACT_BATCH_AMOUNT_ATOMIC, EXTRACT_BATCH_PATH } from "./extract-batch-config.mjs";
import { LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC, LOCKFILE_PIN_DELTA_PATH } from "./lockfile-pin-delta-config.mjs";
import { lockfilePinDeltaMcpOutputSchema } from "./lockfile-pin-delta.mjs";
import { mcpToolNameForRoute } from "./machine-surface-parity.mjs";
import { usdcTermsForNetwork } from "./x402-payment-terms.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_URL = "https://agents.samedaydesk.com";
const NETWORK = "eip155:8453";
const ASSET = usdcTermsForNetwork(NETWORK).asset;
const DECLARED = [
  { name: "extract", method: "GET", path: "/extract", amount: "5000", wrongMethod: "POST" },
  { name: "extract_batch", method: "POST", path: EXTRACT_BATCH_PATH, amount: EXTRACT_BATCH_AMOUNT_ATOMIC, wrongMethod: "GET" },
  { name: "lockfile_pin_delta", method: "POST", path: LOCKFILE_PIN_DELTA_PATH, amount: LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC, wrongMethod: "GET" },
];

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

function contract(schema) {
  if (Array.isArray(schema)) return schema.map(contract);
  if (schema && typeof schema === "object") {
    return Object.fromEntries(Object.entries(schema)
      .filter(([key]) => key !== "description" && key !== "$schema")
      .map(([key, value]) => [key,
        ["properties", "patternProperties", "$defs", "definitions"].includes(key)
          ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, contract(child)]))
          : contract(value)]));
  }
  return schema;
}

async function startFakeFacilitator() {
  const server = createHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        kinds: [{ network: NETWORK, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unexpected_test_facilitator_request" }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant(dataDir, facilitatorUrl) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(port),
      PUBLIC_URL,
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      EXTRACT_BATCH_ENABLED: "1",
      LOCKFILE_PIN_DELTA_ENABLED: "1",
      PAGE_CHANGE_HTTP_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`) || !output.includes("MCP server:  POST /mcp (25 paid tools)")) return;
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
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function challengeAmount(response) {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "declared method omitted payment-required");
  const challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const accepted = challenge.accepts.find((entry) => entry.scheme === "exact" && entry.network === NETWORK);
  assert.ok(accepted, "declared method omitted the exact Base challenge");
  assert.equal(accepted.asset.toLowerCase(), ASSET.toLowerCase());
  return accepted.amount;
}

test("declared methods, tool text, catalogs, and output schemas stay aligned", { timeout: 90_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "discovery-method-parity-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant(dataDir, facilitator.url);
  const [catalog, openapi, skill, llms, gateway] = await Promise.all([
    fetch(`${merchant.base}/api/actions`).then((response) => response.json()),
    fetch(`${merchant.base}/openapi.json`).then((response) => response.json()),
    fetch(`${merchant.base}/skill.md`).then((response) => response.text()),
    fetch(`${merchant.base}/llms.txt`).then((response) => response.text()),
    fetch(`${merchant.base}/`).then((response) => response.json()),
  ]);
  assert.equal(catalog.actions.length, 25);
  assert.equal(catalog.freeRecipes.every((recipe) => recipe.charged === false && recipe.priceAtomicUsdc === null), true);
  assert.equal(JSON.stringify(catalog.freeRecipes).includes("not mcp://"), false);
  assert.equal(JSON.stringify(gateway).includes("not mcp://"), false);
  assert.match(gateway.paidRoutes["GET /extract?url="], /^\$0\.005 - /);
  assert.match(gateway.paidRoutes["POST /extract/batch"], /^\$0\.01 - /);
  assert.match(gateway.paidRoutes["POST /lockfile-pin-delta"], /^\$0\.005 - /);
  for (const declared of DECLARED) {
    const action = catalog.actions.find((entry) => entry.route === declared.path);
    assert.equal(action.method, declared.method);
    assert.equal(action.priceAtomicUsdc, declared.amount);
    assert.equal(String(action.description).includes("not mcp://"), false);
    assert.equal(Boolean(openapi.paths[declared.path][declared.method.toLowerCase()]), true);
    assert.equal(openapi.paths[declared.path][declared.wrongMethod.toLowerCase()], undefined);
    assert.match(skill, new RegExp(`- ${declared.method} ${declared.path}:`));
    if (declared.method === "POST") assert.match(llms, new RegExp(`\\[POST ${declared.path}\\]`));
    const wrong = await fetch(`${merchant.base}${declared.path}`, {
      method: declared.wrongMethod,
      headers: declared.wrongMethod === "POST" ? { "content-type": "application/json" } : {},
      ...(declared.wrongMethod === "POST" ? { body: "{}" } : {}),
    });
    assert.equal(wrong.status, 404, `${declared.wrongMethod} ${declared.path}`);
    assert.equal(wrong.headers.get("payment-required"), null);
    await wrong.arrayBuffer();
  }
  const extract = await fetch(`${merchant.base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(extract.status, 402);
  assert.equal(challengeAmount(extract), "5000");
  const batch = await fetch(`${merchant.base}${EXTRACT_BATCH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls: ["https://example.com/"] }),
  });
  assert.equal(batch.status, 402);
  assert.equal(challengeAmount(batch), EXTRACT_BATCH_AMOUNT_ATOMIC);
  const lockfile = await fetch(`${merchant.base}${LOCKFILE_PIN_DELTA_PATH}`, { method: "POST" });
  assert.equal(lockfile.status, 402);
  assert.equal(challengeAmount(lockfile), LOCKFILE_PIN_DELTA_AMOUNT_ATOMIC);

  const client = new Client({ name: "discovery-method-parity", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  let tools;
  try {
    tools = (await client.listTools()).tools;
  } finally {
    await client.close();
  }
  assertExtractDiscoveryInventory(tools);
  const lockfileTool = tools.find((tool) => tool.name === "lockfile_pin_delta");
  assert.deepEqual(
    contract(lockfileTool.outputSchema),
    contract(toJsonSchemaCompat(lockfilePinDeltaMcpOutputSchema, { strictUnions: true, pipeStrategy: "output" })),
  );
  for (const declared of DECLARED) {
    const tool = tools.find((entry) => entry.name === declared.name);
    assert.match(tool.description, new RegExp(`bound to ${declared.method} ${PUBLIC_URL}${declared.path}, not mcp://`));
    assert.equal(tool.inputSchema?.description, undefined);
    const action = catalog.actions.find((entry) => mcpToolNameForRoute(entry.route) === declared.name);
    assert.equal(action.method, declared.method);
    assert.equal(action.route, declared.path);
  }
  for (const name of ["careers_board_cold", "report_caller_result", "recover_paid_result"]) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool, name);
    assert.equal(String(tool.description).includes("not mcp://"), false);
    assert.equal(tool._meta?.samedaydesk?.charged, false);
    if (name !== "recover_paid_result") assert.match(tool.description, /charged is false/);
  }
  assert.equal(tools.some((tool) => tool.name === "page_change"), false);
});
