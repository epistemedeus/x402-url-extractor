// Official client matrix for the mounted merchant. Legacy SDK 1.30.0 and
// current client 2.4.0 (default legacy mode, and auto fallback) use
// POST /mcp/page-change on protocol 2025-11-25. An explicit 2026-07-28 pin
// is refused there. Paid POST /mcp still accepts that pin, challenges
// without verify or settle, and keeps MPP off. Synthetic facilitator only.
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
import { pageChangeRequestExample } from "./page-change-input-contract.mjs";
import { ownedPageChangeWorkerCount } from "./page-change-http.mjs";
import { PAGE_CHANGE_MCP_PATH, PAGE_CHANGE_MCP_TOOL } from "./page-change-mcp.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const UNKNOWN_TOOL = "not_a_tool";
const LEGACY_PROTOCOL = "2025-11-25";
const CURRENT_PROTOCOL = "2026-07-28";

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

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function parseRpc(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  const messages = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    messages.push(JSON.parse(payload));
  }
  return messages.find((message) => message && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) || messages.at(-1) || null;
}

function watchFetch(origin) {
  const events = [];
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await original(input, init);
    if (!String(url).startsWith(origin)) return response;
    let requestBody = null;
    if (typeof init.body === "string") {
      try { requestBody = JSON.parse(init.body); } catch { requestBody = null; }
    }
    const text = await response.clone().text();
    let rpc = null;
    try { rpc = parseRpc(text); } catch { rpc = null; }
    events.push({
      method: requestBody?.method || init.method || "GET",
      tool: requestBody?.params?.name || null,
      requestedProtocol: requestBody?.params?.protocolVersion
        || requestBody?.params?._meta?.["io.modelcontextprotocol/protocolVersion"]
        || headerValue(init.headers, "mcp-protocol-version")
        || null,
      mcpMethod: headerValue(init.headers, "mcp-method"),
      paymentSignature: headerValue(init.headers, "payment-signature") ? "present" : null,
      status: response.status,
      errorCode: rpc?.error?.code ?? null,
      errorMessage: rpc?.error?.message ? String(rpc.error.message).slice(0, 240) : null,
      responseProtocol: rpc?.result?.protocolVersion ?? null,
      resultType: rpc?.result?.resultType ?? null,
    });
    return response;
  };
  return {
    events,
    restore() { globalThis.fetch = original; },
  };
}

function toolBody(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  const parsed = JSON.parse(text);
  if (result.structuredContent) assert.deepEqual(result.structuredContent, parsed);
  return parsed;
}

async function connectLegacy(url) {
  const client = new LegacyClient({ name: "legacy-official", version: "1.30.0" });
  const transport = new LegacyTransport(new URL(url));
  await client.connect(transport);
  let closed = false;
  return {
    client,
    protocol: () => transport.protocolVersion,
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}

async function connectCurrent(url, mode = "default") {
  const options = mode === "default" ? undefined : { versionNegotiation: { mode } };
  const client = new CurrentClient({ name: "current-official", version: "2.4.0" }, options);
  const transport = new CurrentTransport(new URL(url));
  await client.connect(transport);
  let closed = false;
  return {
    client,
    protocol: () => client.getNegotiatedProtocolVersion(),
    server: () => client.getServerVersion(),
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}

async function rejectedUnknownTool(client) {
  try {
    await client.callTool({ name: UNKNOWN_TOOL, arguments: {} });
  } catch (error) {
    return error;
  }
  assert.fail("unknown tool returned a tool result");
}

function startFacilitator() {
  const calls = [];
  const server = createHttpServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/supported") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
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

async function startMerchant() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "h99110-mcp-"));
  const facilitator = await startFacilitator();
  const port = await unusedPort();
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
      PAGE_CHANGE_HTTP_ENABLED: "1",
      PAGE_CHANGE_SOURCE_COMMIT: "",
      SOURCE_COMMIT: "",
      RAILWAY_GIT_COMMIT_SHA: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`merchant startup timed out: ${output.slice(-2000)}`)), 40000);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-80000);
        if (output.includes("MCP server:  POST /mcp")) {
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
    output: () => output,
    facilitator,
    async close() {
      await stopChild(child);
      await facilitator.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function freeComparison(session) {
  const listed = await session.client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), [PAGE_CHANGE_MCP_TOOL]);
  assert.equal(listed.tools[0]._meta.samedaydesk.charged, false);
  assert.equal(listed.tools[0]._meta.samedaydesk.paymentRequired, false);
  const result = await session.client.callTool({
    name: PAGE_CHANGE_MCP_TOOL,
    arguments: pageChangeRequestExample(),
  });
  assert.notEqual(result.isError, true);
  const body = toolBody(result);
  assert.equal(body.ok, true);
  assert.equal(body.charged, false);
  assert.equal(body.report.verdict, "changed");
  const unknown = await rejectedUnknownTool(session.client);
  assert.equal(unknown.code, -32602);
  assert.match(String(unknown.message), /Unknown tool/);
  assert.equal(String(unknown.message).includes(UNKNOWN_TOOL), false);
  const invalid = await session.client.callTool({
    name: PAGE_CHANGE_MCP_TOOL,
    arguments: { before: {}, after: {}, fields: ["title"], clock: "yesterday" },
  });
  assert.equal(invalid.isError, true);
  const invalidBody = toolBody(invalid);
  assert.equal(invalidBody.charged, false);
  assert.equal(invalidBody.code, "invalid_page_change_input");
  assert.equal(invalidBody.ok, false);
  return body;
}

test("mounted merchant accepts official legacy and current clients without settlement", async (t) => {
  const merchant = await startMerchant();
  const wire = watchFetch(merchant.base);
  t.after(async () => {
    wire.restore();
    await merchant.close();
    assert.equal(ownedPageChangeWorkerCount(), 0);
  });
  assert.match(merchant.output(), /protocols:\s+x402 \+ MPP \(disabled\)/);
  const freeUrl = `${merchant.base}${PAGE_CHANGE_MCP_PATH}`;
  const paidUrl = `${merchant.base}/mcp`;

  const legacy = await connectLegacy(freeUrl);
  t.after(() => legacy.close());
  assert.equal(legacy.protocol(), LEGACY_PROTOCOL);
  const legacyBody = await freeComparison(legacy);
  assert.equal(legacyBody.charged, false);
  await legacy.close();

  const currentDefault = await connectCurrent(freeUrl);
  t.after(() => currentDefault.close());
  assert.equal(currentDefault.protocol(), LEGACY_PROTOCOL);
  assert.deepEqual(currentDefault.server(), {
    name: "samedaydesk-page-compare",
    version: SERVICE_VERSION,
  });
  await freeComparison(currentDefault);
  await currentDefault.close();
  const recovered = await connectCurrent(freeUrl);
  t.after(() => recovered.close());
  assert.equal(recovered.protocol(), LEGACY_PROTOCOL);
  const recoveredBody = toolBody(await recovered.client.callTool({
    name: PAGE_CHANGE_MCP_TOOL,
    arguments: pageChangeRequestExample(),
  }));
  assert.equal(recoveredBody.ok, true);
  assert.equal(recoveredBody.charged, false);
  assert.equal(recoveredBody.report.verdict, "changed");
  await recovered.close();

  const automatic = await connectCurrent(freeUrl, "auto");
  t.after(() => automatic.close());
  assert.equal(automatic.protocol(), LEGACY_PROTOCOL);
  const automaticBody = toolBody(await automatic.client.callTool({
    name: PAGE_CHANGE_MCP_TOOL,
    arguments: pageChangeRequestExample(),
  }));
  assert.equal(automaticBody.charged, false);
  assert.equal(automaticBody.report.verdict, "changed");
  await automatic.close();

  const pinnedFree = new CurrentClient({ name: "current-pin", version: "2.4.0" }, {
    versionNegotiation: { mode: { pin: CURRENT_PROTOCOL } },
  });
  await assert.rejects(
    () => pinnedFree.connect(new CurrentTransport(new URL(freeUrl))),
    (error) => error instanceof SdkError && error.code === "ERA_NEGOTIATION_FAILED",
  );
  await pinnedFree.close().catch(() => {});

  const pinnedPaid = await connectCurrent(paidUrl, { pin: CURRENT_PROTOCOL });
  t.after(() => pinnedPaid.close());
  assert.equal(pinnedPaid.protocol(), CURRENT_PROTOCOL);
  assert.equal(pinnedPaid.server().name, "x402-data-gateway");
  const paidTools = await pinnedPaid.client.listTools();
  assert.equal(paidTools.tools.some((tool) => tool.name === PAGE_CHANGE_MCP_TOOL), false);
  const cold = paidTools.tools.find((tool) => tool.name === "careers_board_cold");
  assert.equal(cold._meta.samedaydesk.charged, false);
  const enrich = paidTools.tools.find((tool) => tool.name === "enrich");
  assert.equal(enrich._meta.x402.paymentRequired, true);
  assert.equal(enrich._meta.x402.accepts.some((item) => item.scheme === "mpp" || item.protocol === "mpp"), false);
  const coldResult = await pinnedPaid.client.callTool({ name: "careers_board_cold", arguments: {} });
  assert.notEqual(coldResult.isError, true);
  const coldBody = toolBody(coldResult);
  assert.equal(coldBody.charged, false);
  const challenge = await pinnedPaid.client.callTool({
    name: "enrich",
    arguments: { domain: "synthetic.example.invalid" },
  });
  assert.equal(challenge.isError, true);
  const challengeBody = toolBody(challenge);
  assert.equal(challengeBody.x402Version, 2);
  assert.ok(Array.isArray(challengeBody.accepts) && challengeBody.accepts.length > 0);
  assert.equal(challengeBody.accepts.every((item) => item.scheme === "exact"), true);
  assert.equal(JSON.stringify(challengeBody).includes("\"mpp\""), false);
  const paidUnknown = await rejectedUnknownTool(pinnedPaid.client);
  assert.equal(paidUnknown.code, -32602);
  assert.equal(String(paidUnknown.message).includes(UNKNOWN_TOOL), false);
  await pinnedPaid.close();
  const paidRecovered = await connectCurrent(paidUrl, { pin: CURRENT_PROTOCOL });
  t.after(() => paidRecovered.close());
  assert.equal(paidRecovered.protocol(), CURRENT_PROTOCOL);
  const coldAgain = toolBody(await paidRecovered.client.callTool({ name: "careers_board_cold", arguments: {} }));
  assert.equal(coldAgain.charged, false);
  await paidRecovered.close();

  assert.equal(wire.events.some((event) => event.paymentSignature), false);
  const discover = wire.events.filter((event) => event.method === "server/discover");
  assert.ok(discover.length >= 1);
  assert.equal(discover.every((event) => event.requestedProtocol === CURRENT_PROTOCOL), true);
  const freeDiscover = discover.filter((event) => event.status === 400);
  assert.ok(freeDiscover.length >= 1);
  assert.equal(freeDiscover.every((event) => event.errorCode === -32000), true);
  assert.match(freeDiscover[0].errorMessage, /Unsupported protocol version: 2026-07-28/);
  assert.match(freeDiscover[0].errorMessage, /2025-11-25/);
  const paidDiscover = discover.find((event) => event.status === 200 && event.resultType === "complete");
  assert.ok(paidDiscover);
  const modernCalls = wire.events.filter((event) => event.requestedProtocol === CURRENT_PROTOCOL && event.method === "tools/call" && event.tool === "careers_board_cold");
  assert.ok(modernCalls.length >= 1);
  assert.equal(modernCalls.every((event) => event.resultType === "complete"), true);
  assert.equal(merchant.facilitator.calls.some((call) => /verify|settle/i.test(call)), false);
  assert.ok(merchant.facilitator.calls.some((call) => call === "GET /supported"));
});
