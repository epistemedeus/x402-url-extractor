// Mounted producer, transport, and consumer check for the registered MCP
// inventory. Optional tools follow explicit flags. The free page-comparison
// route stays a separate one-tool consumer. No paid call, signer, or settle.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as CurrentClient, SdkError } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport as CurrentTransport } from "@modelcontextprotocol/client";
import { compareMcpCatalog } from "./mcp-catalog-projection.mjs";
import { PAGE_CHANGE_MCP_PATH, PAGE_CHANGE_MCP_TOOL } from "./page-change-mcp.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_PROTOCOL = "2026-07-28";
const ALWAYS_FREE = ["careers_board_cold", "report_caller_result", "trial_read", "recover_paid_result"];

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

function startFacilitator() {
  const calls = [];
  const server = createHttpServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    if (req.method === "GET" && req.url === "/supported") {
      res.end(JSON.stringify({
        kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    res.end(JSON.stringify({ isValid: false, success: false }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve({
      calls,
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
    server.once("error", reject);
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.kill("SIGTERM");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startMerchant(flags) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "mcp-catalog-"));
  const facilitator = await startFacilitator();
  const port = await unusedPort();
  const paidCount = 23 + (flags.extractBatch ? 1 : 0) + (flags.lockfile ? 1 : 0);
  const child = spawn(process.execPath, ["--max-old-space-size=512", "server.js"], {
    cwd,
    env: {
      ...process.env,
      NODE_OPTIONS: "--max-old-space-size=512",
      PORT: String(port),
      NETWORK: "eip155:8453",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitator.url,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      EXTRACT_BATCH_ENABLED: flags.extractBatch ? "1" : "",
      LOCKFILE_PIN_DELTA_ENABLED: flags.lockfile ? "1" : "",
      PAGE_CHANGE_HTTP_ENABLED: flags.pageChange ? "1" : "",
      PAGE_CHANGE_SOURCE_COMMIT: "",
      SOURCE_COMMIT: "",
      RAILWAY_GIT_COMMIT_SHA: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let startupProbe = null;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`merchant startup timed out: ${output.slice(-2000)}`)), 40000);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-80000);
        if (!startupProbe && output.includes(`x402-merchant listening on :${port}`)) {
          startupProbe = fetch(`http://127.0.0.1:${port}/mcp`).then(async (response) => ({
            status: response.status,
            cacheControl: response.headers.get("cache-control"),
            body: await response.json(),
          })).catch((error) => ({ error: String(error && error.message || error) }));
        }
        if (output.includes(`MCP server:  POST /mcp (${paidCount} paid tools)`)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`merchant exited early code=${code} signal=${signal}\n${output.slice(-4000)}`));
      });
    });
  } catch (error) {
    await stopChild(child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  return {
    base: `http://127.0.0.1:${port}`,
    paidCount,
    startupProbe,
    facilitator,
    async close() {
      await stopChild(child);
      await facilitator.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function connectLegacy(url) {
  const client = new LegacyClient({ name: "catalog-legacy", version: "1.30.0" });
  const transport = new LegacyTransport(new URL(url));
  await client.connect(transport);
  return {
    client,
    close: async () => client.close(),
  };
}

async function connectCurrent(url) {
  const client = new CurrentClient({ name: "catalog-current", version: "2.4.0" }, {
    versionNegotiation: { mode: { pin: CURRENT_PROTOCOL } },
  });
  const transport = new CurrentTransport(new URL(url));
  await client.connect(transport);
  return {
    client,
    protocol: () => client.getNegotiatedProtocolVersion(),
    close: async () => client.close(),
  };
}

function expectConfigured(descriptor, listed, flags) {
  const freeNames = [...(flags.pageChange ? ["page_change"] : []), ...ALWAYS_FREE];
  assert.equal(descriptor.registered, true);
  assert.equal(descriptor.mountState, "ready");
  assert.equal(descriptor.paidToolCount, 23 + (flags.extractBatch ? 1 : 0) + (flags.lockfile ? 1 : 0));
  assert.equal(descriptor.toolCount, descriptor.paidToolCount + freeNames.length);
  assert.deepEqual(descriptor.tools.filter((tool) => tool.charged === false).map((tool) => tool.name), freeNames);
  assert.equal(descriptor.tools.some((tool) => tool.name === "extract_batch"), flags.extractBatch === true);
  assert.equal(descriptor.tools.some((tool) => tool.name === "lockfile_pin_delta"), flags.lockfile === true);
  assert.equal(descriptor.tools.some((tool) => tool.name === PAGE_CHANGE_MCP_TOOL), false);
  const agreement = compareMcpCatalog(descriptor, listed);
  assert.equal(agreement.ok, true, JSON.stringify(agreement.differences));
  const byName = new Map(listed.map((tool) => [tool.name, tool]));
  assert.equal(Boolean(byName.get("trial_read").outputSchema), true);
  assert.equal(byName.get("trial_read").outputSchema.properties.charged.const, false);
  assert.equal(Boolean(byName.get("extract").outputSchema), true);
  assert.equal(byName.get("extract").outputSchema.type, "object");
  assert.equal(Boolean(byName.get("careers_board_cold").outputSchema), false);
  assert.equal(Boolean(byName.get("recover_paid_result").outputSchema), false);
  if (flags.pageChange) assert.equal(Boolean(byName.get("page_change").outputSchema), false);
  const stale = {
    ...descriptor,
    toolCount: descriptor.paidToolCount,
    tools: descriptor.tools.filter((tool) => tool.charged),
  };
  const staleResult = compareMcpCatalog(stale, listed);
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.differences.some((item) => item.code === "count"), true);
  const missing = listed.filter((tool) => tool.name !== "recover_paid_result");
  assert.equal(compareMcpCatalog(descriptor, missing).ok, false);
  const unexpected = [...listed, { name: PAGE_CHANGE_MCP_TOOL, outputSchema: { type: "object" }, _meta: { samedaydesk: { charged: false } } }];
  const falseTool = compareMcpCatalog(descriptor, unexpected);
  assert.equal(falseTool.differences.some((item) => item.code === "names" && item.missing.includes(PAGE_CHANGE_MCP_TOOL)), true);
}

async function assertUnrelatedConsumers(merchant) {
  const extract = await fetch(`${merchant.base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(extract.status, 402);
  const openapi = await fetch(`${merchant.base}/openapi.json`).then((response) => response.json());
  assert.ok(openapi.paths["/extract"].get["x-payment-info"]);
  const actions = await fetch(`${merchant.base}/api/actions`).then((response) => response.json());
  assert.equal(actions.actions.length, merchant.paidCount);
  const home = await fetch(merchant.base, { headers: { accept: "text/html" } });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.equal(html.includes("toolCount"), false);
  assert.equal(html.includes("paidToolCount"), false);
  assert.equal(html.includes("recover_paid_result"), false);
  const freeGet = await fetch(`${merchant.base}${PAGE_CHANGE_MCP_PATH}`);
  assert.equal(freeGet.status, 405);
  const freeList = await connectLegacy(`${merchant.base}${PAGE_CHANGE_MCP_PATH}`);
  try {
    const listed = await freeList.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [PAGE_CHANGE_MCP_TOOL]);
    assert.equal(Boolean(listed.tools[0].outputSchema), true);
  } finally {
    await freeList.close();
  }
  const pinnedFree = new CurrentClient({ name: "catalog-free-pin", version: "2.4.0" }, {
    versionNegotiation: { mode: { pin: CURRENT_PROTOCOL } },
  });
  await assert.rejects(
    () => pinnedFree.connect(new CurrentTransport(new URL(`${merchant.base}${PAGE_CHANGE_MCP_PATH}`))),
    (error) => error instanceof SdkError && error.code === "ERA_NEGOTIATION_FAILED",
  );
  await pinnedFree.close().catch(() => {});
}

async function checkConfiguration(flags, { negotiate = false } = {}) {
  const merchant = await startMerchant(flags);
  try {
    const startup = await merchant.startupProbe;
    assert.equal(startup.error, undefined);
    assert.equal(startup.status, 200);
    assert.notEqual(startup.body.mountState, "ready");
    assert.equal(startup.cacheControl, "no-store");
    assert.equal(startup.body.registered, false);
    const descriptorResponse = await fetch(`${merchant.base}/mcp`);
    assert.equal(descriptorResponse.headers.get("cache-control"), "public, max-age=300");
    const descriptor = await descriptorResponse.json();
    const legacy = await connectLegacy(`${merchant.base}/mcp`);
    try {
      const listed = await legacy.client.listTools();
      expectConfigured(descriptor, listed.tools, flags);
    } finally {
      await legacy.close();
    }
    if (negotiate) {
      const current = await connectCurrent(`${merchant.base}/mcp`);
      try {
        assert.equal(current.protocol(), CURRENT_PROTOCOL);
        const listed = await current.client.listTools();
        const againResponse = await fetch(`${merchant.base}/mcp`);
        assert.equal(againResponse.headers.get("cache-control"), "public, max-age=300");
        const again = await againResponse.json();
        expectConfigured(again, listed.tools, flags);
      } finally {
        await current.close();
      }
    }
    await assertUnrelatedConsumers(merchant);
    assert.equal(merchant.facilitator.calls.some((call) => call.startsWith("POST /settle")), false);
    assert.equal(merchant.facilitator.calls.some((call) => call.startsWith("POST /verify")), false);
  } finally {
    await merchant.close();
  }
}

test("default, full, and free-only catalogs agree across GET and tools/list", { timeout: 180000 }, async () => {
  await checkConfiguration({}, { negotiate: true });
  await checkConfiguration({ extractBatch: true, lockfile: true, pageChange: true });
});
