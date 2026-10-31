import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { MCP_JSON_RPC_MAX_BYTES, mcpJsonRpcOverlimitBody } from "./mcp-json-rpc-limit.mjs";
import { pageChangeRequestExample } from "./page-change-input-contract.mjs";
import { PAGE_CHANGE_HTTP_PATH, ownedPageChangeWorkerCount } from "./page-change-http.mjs";
import {
  PAGE_CHANGE_MCP_ANNOTATIONS,
  PAGE_CHANGE_MCP_INSTRUCTIONS,
  PAGE_CHANGE_MCP_PATH,
  PAGE_CHANGE_MCP_SERVER_NAME,
  PAGE_CHANGE_MCP_TOOL,
  mountPageChangeMcp,
} from "./page-change-mcp.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";
import { mountPageChangeHttp } from "./page-change-http.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const fx = (...parts) => path.join(cwd, "examples/customer-x402/fixtures/page-change", ...parts);
const load = async (...parts) => JSON.parse(await readFile(fx(...parts), "utf8"));
const enabledEnv = { PAGE_CHANGE_HTTP_ENABLED: "1" };
const ACCEPT = "application/json, text/event-stream";

function stable(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => (key === "elapsedMs" ? undefined : item)));
}

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

function parseRpcBody(text) {
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

async function postRpc(base, body, { path: rpcPath = PAGE_CHANGE_MCP_PATH, headers = {}, method = "POST" } = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const response = await fetch(`${base}${rpcPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: ACCEPT,
      ...headers,
    },
    body: method === "GET" || method === "HEAD" ? undefined : payload,
  });
  const text = await response.text();
  let json = null;
  try { json = parseRpcBody(text); } catch { json = null; }
  return { response, text, json };
}

async function postDirect(base, body) {
  const response = await fetch(`${base}${PAGE_CHANGE_HTTP_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { response, json, text };
}

async function listenProfile(env) {
  const app = express();
  mountPageChangeHttp(app, { env });
  mountPageChangeMcp(app, { env });
  const server = createHttpServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function connectClient(base, rpcPath = PAGE_CHANGE_MCP_PATH) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}${rpcPath}`));
  const client = new Client({ name: "page-change-mcp-test", version: "0" });
  await client.connect(transport);
  return {
    client,
    transport,
    async close() {
      await client.close();
    },
  };
}

function toolJson(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  const parsed = JSON.parse(text);
  if (result.structuredContent) assert.deepEqual(stable(result.structuredContent), stable(parsed));
  return parsed;
}

async function startFakeFacilitator() {
  let hits = 0;
  const server = createHttpServer((req, res) => {
    hits += 1;
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
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    hits: () => hits,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startSink() {
  let hits = 0;
  const server = createHttpServer((req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>sink must stay unused</title>");
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    hits: () => hits,
    url: `http://127.0.0.1:${server.address().port}/page`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
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
  const dataDir = await mkdtemp(path.join(tmpdir(), "page-change-mcp-"));
  const facilitator = await startFakeFacilitator();
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      NETWORK: "eip155:8453",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitator.url,
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      PAGE_CHANGE_HTTP_ENABLED: "1",
      PAGE_CHANGE_SOURCE_COMMIT: "",
      SOURCE_COMMIT: "",
      RAILWAY_GIT_COMMIT_SHA: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const started = Date.now();
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
  return {
    base: `http://127.0.0.1:${port}`,
    output: () => output,
    startupMs: Date.now() - started,
    child,
    facilitator,
    async close() {
      await stopChild(child);
      await facilitator.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test.before(async () => {
  globalThis.pageChangeProfile = await listenProfile(enabledEnv);
});

test.after(async () => {
  await globalThis.pageChangeProfile?.close();
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("SDK client initializes one free tool and closes", async () => {
  const base = globalThis.pageChangeProfile.base;
  const session = await connectClient(base);
  try {
    assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(LATEST_PROTOCOL_VERSION));
    assert.equal(session.transport.protocolVersion, LATEST_PROTOCOL_VERSION);
    assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(session.transport.protocolVersion));
    const info = session.client.getServerVersion();
    assert.equal(info.name, PAGE_CHANGE_MCP_SERVER_NAME);
    assert.equal(info.version, SERVICE_VERSION);
    const listed = await session.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [PAGE_CHANGE_MCP_TOOL]);
    const tool = listed.tools[0];
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
    assert.deepEqual(tool.annotations, PAGE_CHANGE_MCP_ANNOTATIONS);
    assert.equal(tool._meta.samedaydesk.charged, false);
    assert.equal(tool._meta.samedaydesk.paymentRequired, false);
    assert.equal(listed.tools.some((item) => item.name === "extract" || item.name === "page_change" || item.name === "trial_read"), false);
  } finally {
    await session.close();
  }
  const raw = await postRpc(base, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "raw", version: "0" },
    },
  });
  assert.equal(raw.response.status, 200);
  assert.equal(raw.json.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.equal(raw.json.result.serverInfo.name, PAGE_CHANGE_MCP_SERVER_NAME);
  assert.match(raw.json.result.instructions, /compare_page_observations/);
  assert.equal(raw.json.result.instructions, PAGE_CHANGE_MCP_INSTRUCTIONS);
  const stale = await postRpc(base, {
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: {
      protocolVersion: "1999-01-01",
      capabilities: {},
      clientInfo: { name: "raw", version: "0" },
    },
  });
  assert.equal(stale.response.status, 200);
  assert.notEqual(stale.json.result.protocolVersion, "1999-01-01");
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(stale.json.result.protocolVersion));
});

test("meaningful MCP output matches the direct page-change route", async () => {
  const base = globalThis.pageChangeProfile.base;
  const session = await connectClient(base);
  const w5 = async (id) => ({
    before: await load("w5-corpus", "cases", id, "observation-before.json"),
    after: await load("w5-corpus", "cases", id, "observation-after.json"),
    fields: (await load("w5-corpus", "cases", id, "expected.json")).buyer_owned_dependent_fields,
  });
  const cases = [
    ["changed", await w5("case-0001-changed_selected_fields"), "changed"],
    ["unchanged", await w5("case-0000-unchanged_pages"), "unchanged"],
    ["reordered", await w5("case-0002-row_reorder"), "reordered"],
    ["incomplete", await w5("case-0004-missing_requested_field"), "incomplete"],
    ["ambiguous", { before: await load("merchant", "duplicate-active.json"), after: await load("merchant", "duplicate-active.json"), fields: ["title"] }, "ambiguous"],
    ["incomparable", { before: {}, after: {}, fields: ["title"] }, "incomparable"],
    ["public-example", pageChangeRequestExample(), "changed"],
  ];
  try {
    for (const [name, input, verdict] of cases) {
      const direct = await postDirect(base, input);
      const viaTool = await session.client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: input });
      assert.notEqual(viaTool.isError, true, name);
      const mcp = toolJson(viaTool);
      assert.equal(direct.response.status, 200, name);
      assert.deepEqual(stable(mcp), stable(direct.json), name);
      assert.equal(mcp.ok, true, name);
      assert.equal(mcp.charged, false, name);
      assert.equal(mcp.report.verdict, verdict, name);
      assert.equal(mcp.report.provenance.digestSha256, direct.json.report.provenance.digestSha256, name);
      assert.equal(Object.hasOwn(stable(mcp).report.provenance, "elapsedMs"), false);
    }
    const held = { before: {}, after: {}, fields: ["title"] };
    const admitted = [
    ["bad clock", { ...held, clock: "yesterday" }, "invalid_page_change_input"],
    ["filesystem path", { before: { path: "/tmp/x" }, after: {}, fields: ["title"] }, "invalid_page_change_input"],
    ["url only", { before: { url: "https://example.invalid/before" }, after: { url: "https://example.invalid/after" }, fields: ["title"] }, "invalid_page_change_input"],
    ["limit raise", { before: { maxBytes: 999999 }, after: {}, fields: ["title"] }, "invalid_page_change_input"],
    ];
    for (const [name, input, code] of admitted) {
      const direct = await postDirect(base, input);
      const viaTool = await session.client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: input });
      assert.equal(viaTool.isError, true, name);
      assert.equal(viaTool.structuredContent, undefined, name);
      const mcp = toolJson(viaTool);
      assert.equal(direct.json.code, code, name);
      assert.equal(mcp.code, direct.json.code, name);
      assert.equal(mcp.error, direct.json.error, name);
      assert.equal(mcp.message, direct.json.message, name);
      assert.equal(mcp.charged, false, name);
      assert.equal(mcp.report, undefined, name);
    }
    const extra = { ...held, url: "https://example.invalid/fetch-me" };
    const directExtra = await postDirect(base, extra);
    const viaExtra = await session.client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: extra });
    assert.equal(viaExtra.isError, true);
    const extraBody = toolJson(viaExtra);
    assert.equal(extraBody.code, directExtra.json.code);
    assert.equal(extraBody.message, directExtra.json.message);
    assert.equal(extraBody.charged, false);
    assert.equal(extraBody.report, undefined);
    const viaFresh = await session.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { ...held, allowFreshClaim: true },
    });
    assert.equal(viaFresh.isError, true);
    assert.equal(viaFresh.structuredContent, undefined);
    const freshText = viaFresh.content.find((item) => item.type === "text").text;
    assert.match(freshText, /-32602/);
    assert.match(freshText, /allowFreshClaim/);
  } finally {
    await session.close();
  }
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("malformed, oversized, wrong method, batch, and unknown tools never compare", async () => {
  const base = globalThis.pageChangeProfile.base;
  const broken = await postRpc(base, "{");
  assert.equal(broken.response.status, 400);
  assert.equal(broken.json.ok, false);
  assert.equal(broken.json.error, "invalid_json");
  assert.equal(broken.json.code, "invalid_json");
  assert.equal(broken.json.charged, false);
  assert.equal(broken.json.product, "samedaydesk-page-change-http");

  const media = await postRpc(base, { jsonrpc: "2.0", id: 1, method: "tools/list" }, {
    headers: { "content-type": "text/plain" },
  });
  assert.equal(media.response.status, 415);
  assert.equal(media.json.code, "unsupported_media_type");
  assert.equal(media.json.charged, false);

  const over = await fetch(`${base}${PAGE_CHANGE_MCP_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT },
    body: `{"pad":"${"a".repeat(MCP_JSON_RPC_MAX_BYTES)}"}`,
  });
  assert.equal(over.status, 200);
  assert.deepEqual(await over.json(), mcpJsonRpcOverlimitBody());

  const wide = JSON.stringify({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "extract", arguments: { url: "https://example.invalid/" }, pad: "b".repeat(20 * 1024) },
  });
  assert.ok(Buffer.byteLength(wide) > 16 * 1024);
  assert.ok(Buffer.byteLength(wide) < MCP_JSON_RPC_MAX_BYTES);
  const aboveOrdinary = await postRpc(base, wide);
  assert.equal(aboveOrdinary.response.status, 200);
  assert.equal(aboveOrdinary.json.error.code, -32602);
  assert.equal(aboveOrdinary.json.error.message, "Unknown tool");

  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
    const response = await fetch(`${base}${PAGE_CHANGE_MCP_PATH}`, { method, headers: { accept: ACCEPT } });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST", method);
    if (method !== "HEAD") {
      const body = await response.json();
      assert.equal(body.error.code, -32000, method);
      assert.match(body.error.message, /POST JSON-RPC/);
      assert.equal(body.result, undefined, method);
    } else {
      await response.arrayBuffer();
    }
  }

  const batch = await postRpc(base, [
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: PAGE_CHANGE_MCP_TOOL, arguments: { before: {}, after: {}, fields: ["title"] } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "extract", arguments: { url: "https://example.invalid/" } } },
  ]);
  assert.equal(batch.response.status, 400);
  assert.deepEqual(batch.json, { jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: null });

  for (const name of ["extract", "read", "trial_read", "page_change", "compare_pages"]) {
    const refused = await postRpc(base, {
      jsonrpc: "2.0",
      id: name,
      method: "tools/call",
      params: { name, arguments: { url: "https://example.invalid/paid" } },
    });
    assert.equal(refused.response.status, 200, name);
    assert.deepEqual(refused.json, {
      jsonrpc: "2.0",
      id: name,
      error: { code: -32602, message: "Unknown tool" },
    });
  }
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("disabled profile stays mounted and refuses the compare without HTTP 404", async () => {
  const profile = await listenProfile({});
  try {
    const session = await connectClient(profile.base);
    try {
      const listed = await session.client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name), [PAGE_CHANGE_MCP_TOOL]);
      const result = await session.client.callTool({
        name: PAGE_CHANGE_MCP_TOOL,
        arguments: { before: {}, after: {}, fields: ["title"] },
      });
      assert.equal(result.isError, true);
      const body = toolJson(result);
      assert.equal(body.error, "page_change_http_disabled");
      assert.equal(body.charged, false);
      assert.equal(body.ok, false);
    } finally {
      await session.close();
    }
    const probe = await fetch(`${profile.base}${PAGE_CHANGE_MCP_PATH}`);
    assert.equal(probe.status, 405);
    await probe.arrayBuffer();
    const direct = await postDirect(profile.base, { before: {}, after: {}, fields: ["title"] });
    assert.equal(direct.response.status, 404);
    assert.equal(direct.json.error, "page_change_http_disabled");
  } finally {
    await profile.close();
  }
});

test("merchant catalog and payment protections stay unchanged around the free profile", { timeout: 90000 }, async () => {
  const merchant = await startMerchant();
  const sink = await startSink();
  const paid = await connectClient(merchant.base, "/mcp");
  const free = await connectClient(merchant.base);
  try {
    const before = (await paid.client.listTools()).tools.map((tool) => tool.name).sort();
    assert.equal(before.includes("extract"), true);
    assert.equal(before.includes("page_change"), true);
    assert.equal(before.includes(PAGE_CHANGE_MCP_TOOL), false);
    assert.equal(before.includes("trial_read"), true);
    const descriptor = await fetch(`${merchant.base}/mcp`);
    const descriptorText = await descriptor.text();
    assert.equal(descriptor.status, 200);
    assert.equal(descriptorText.includes(PAGE_CHANGE_MCP_TOOL), false);
    assert.equal(descriptorText.includes("page_change"), true);
    const freeList = await free.client.listTools();
    assert.deepEqual(freeList.tools.map((tool) => tool.name), [PAGE_CHANGE_MCP_TOOL]);
    const review = await free.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: {
        before: await load("w5-corpus", "cases", "case-0001-changed_selected_fields", "observation-before.json"),
        after: await load("w5-corpus", "cases", "case-0001-changed_selected_fields", "observation-after.json"),
        fields: ["title", "description"],
      },
    });
    assert.equal(toolJson(review).report.verdict, "changed");
    await assert.rejects(
      () => free.client.callTool({ name: "extract", arguments: { url: sink.url } }),
      (error) => error.code === -32602,
    );
    await assert.rejects(
      () => free.client.callTool({ name: "trial_read", arguments: {} }),
      (error) => error.code === -32602,
    );
    const unpaid = await paid.client.callTool({ name: "extract", arguments: { url: sink.url } });
    const unpaidText = unpaid?.content?.find((item) => item.type === "text")?.text || "";
    let unpaidBody = null;
    try { unpaidBody = JSON.parse(unpaidText); } catch { unpaidBody = null; }
    const challenge = unpaidBody?.x402 || unpaidBody;
    assert.equal(Boolean(challenge?.x402Version || challenge?.accepts), true);
    assert.equal(sink.hits(), 0);
    const extractHttp = await fetch(`${merchant.base}/extract?url=${encodeURIComponent("https://example.com/")}`);
    assert.equal(extractHttp.status, 402);
    await extractHttp.arrayBuffer();
    assert.equal(sink.hits(), 0);
    const after = (await paid.client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(after, before);
    const mounted = await fetch(`${merchant.base}${PAGE_CHANGE_MCP_PATH}`, { method: "GET" });
    assert.equal(mounted.status, 405);
    await mounted.arrayBuffer();
    assert.match(merchant.output(), /MCP server:\s+POST \/mcp \(\d+ paid tools\)/);
    assert.equal(merchant.output().includes(`${PAGE_CHANGE_MCP_TOOL}`), false);
  } finally {
    await free.close();
    await paid.close();
    await sink.close();
    await merchant.close();
  }
  assert.equal(merchant.child.exitCode !== null || merchant.child.signalCode !== null, true);
  await assert.rejects(() => fetch(`${merchant.base}/mcp`));
});
