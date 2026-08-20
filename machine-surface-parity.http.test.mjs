import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { parseLlmsPaidRoutes, validateMachineSurfaceParity } from "./machine-surface-parity.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_MISSING_FROM_LLMS = [
  "/defi/morpho-protection",
  "/work/opportunity-preflight",
  "/commerce/settlement-proof",
  "/chain/transaction-receipt",
  "/chain/solana-transaction-receipt",
];
const CIRCLE_ROUTE = "/gateway/commerce/payment-offer-preflight";

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function readJson(base, route) {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.ok, true, `${route} ${response.status}`);
  return response.json();
}

async function readText(base, route) {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.ok, true, `${route} ${response.status}`);
  return response.text();
}

test("live free surfaces keep canonical paid routes and kill Circle as a 23rd action", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-surface-parity-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`) || !output.includes("MCP server:  POST /mcp (22 paid tools)")) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal(await listening, true);
  const base = `http://127.0.0.1:${port}`;
  const [llms, catalog, agentCard, openapi, mppOpenapi, manifest, mcpDescriptor] = await Promise.all([
    readText(base, "/llms.txt"),
    readJson(base, "/api/actions"),
    readJson(base, "/.well-known/agent-card.json"),
    readJson(base, "/openapi.json"),
    readJson(base, "/mpp-openapi.json"),
    readJson(base, "/.well-known/x402"),
    readJson(base, "/mcp"),
  ]);

  const client = new Client({ name: "surface-parity", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  let mcpToolNames;
  try {
    mcpToolNames = (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }

  const receipt = validateMachineSurfaceParity({
    actions: catalog.actions,
    alternate: catalog.alternateAccess,
    openapi,
    mppOpenapi,
    manifestItems: manifest.items,
    mcpToolNames,
    agentCard,
    catalog,
    llms,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.actionCount, 22);
  assert.equal(receipt.llmsCanonicalCount, 22);
  assert.equal(receipt.llmsAlternateCount, 1);
  assert.equal(receipt.mcpToolCount, 22);
  assert.equal(mcpDescriptor.toolCount, 22);

  const llmsRoutes = parseLlmsPaidRoutes(llms).map((entry) => entry.route);
  for (const route of SNAPSHOT_MISSING_FROM_LLMS) {
    assert.ok(llmsRoutes.includes(route), `llms.txt still missing ${route}`);
    assert.ok(catalog.actions.some((action) => action.route === route), `catalog missing ${route}`);
  }
  assert.ok(llmsRoutes.includes(CIRCLE_ROUTE));
  assert.equal(catalog.alternateAccess.route, CIRCLE_ROUTE);
  assert.equal(catalog.actions.some((action) => action.route === CIRCLE_ROUTE), false);
  assert.equal(JSON.stringify(agentCard).includes(CIRCLE_ROUTE), false);
  assert.equal(mcpToolNames.includes("circle_gateway"), false);
  assert.equal(openapi.paths[CIRCLE_ROUTE]?.get?.["x-payment-info"] != null, true);
  assert.equal(mppOpenapi.paths[CIRCLE_ROUTE], undefined);
});
