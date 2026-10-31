import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
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
import { createCommerceTelemetry } from "./commerce-events.mjs";
import { MCP_JSON_RPC_MAX_BYTES } from "./mcp-json-rpc-limit.mjs";
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

async function listenProfile(env, observe = null) {
  const app = express();
  mountPageChangeHttp(app, { env });
  mountPageChangeMcp(app, { env, observe });
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
    dataDir,
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
  assert.equal(over.status, 413);
  const overBody = await over.json();
  assert.equal(overBody.code, "payload_too_large");
  assert.equal(overBody.charged, false);
  assert.equal(JSON.stringify(overBody).includes("mcp_json_rpc_too_large"), false);

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

function deepToolsCall(depth) {
  const nested = `{"n":`.repeat(depth) + "1" + "}".repeat(depth);
  return `{"jsonrpc":"2.0","id":"deep","method":"tools/call","params":{"name":${JSON.stringify(PAGE_CHANGE_MCP_TOOL)},"arguments":{"before":${nested},"after":{"title":"b"},"fields":["title"]}}}`;
}

function streamMcp(base) {
  let request;
  const result = new Promise((resolve, reject) => {
    request = httpRequest(`${base}${PAGE_CHANGE_MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: ACCEPT },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: response.statusCode, text, json });
      });
    });
    request.on("error", reject);
  });
  result.catch(() => {});
  return { request, result };
}

test("deep raw JSON is a bounded refusal and the same server still accepts an SDK call", async () => {
  const base = globalThis.pageChangeProfile.base;
  const raw = deepToolsCall(3000);
  assert.ok(Buffer.byteLength(raw) > 16 * 1024);
  assert.ok(Buffer.byteLength(raw) < 200 * 1024);
  const parsed = JSON.parse(raw);
  assert.throws(() => structuredClone(parsed.params.arguments), RangeError);
  const crashes = [];
  const onRejection = (error) => crashes.push(error);
  process.on("unhandledRejection", onRejection);
  try {
    const refused = await postRpc(base, raw);
    assert.ok(refused.response.status === 200 || refused.response.status === 400, refused.text);
    assert.equal(refused.text.includes("Maximum call stack"), false);
    assert.equal(`${refused.text}\n${JSON.stringify(refused.json)}`.includes("json_depth_limit"), true);
    assert.equal(ownedPageChangeWorkerCount(), 0);
    const session = await connectClient(base);
    try {
      const result = await session.client.callTool({
        name: PAGE_CHANGE_MCP_TOOL,
        arguments: pageChangeRequestExample(),
      });
      assert.notEqual(result.isError, true);
      const body = toolJson(result);
      assert.equal(body.ok, true);
      assert.equal(body.charged, false);
      assert.equal(body.report.verdict, "changed");
    } finally {
      await session.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(crashes.length, 0);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

function refusalCode(payload) {
  const parsed = payload.json || parseRpcBody(payload.text);
  if (parsed?.code) return parsed.code;
  const text = parsed?.result?.content?.find((item) => item.type === "text")?.text || payload.text;
  try {
    const body = JSON.parse(text);
    if (body?.code) return body.code;
  } catch { /* The tool text is the code carrier when the status stays 200. */ }
  return text.includes("compare_timeout") ? "compare_timeout" : null;
}

test("MCP reuses the page-change byte, upload slot, deadline, and disconnect limits", { timeout: 30000 }, async () => {
  const ceiling = await listenProfile({
    ...enabledEnv,
    PAGE_CHANGE_HTTP_MAX_REQUEST_BYTES: "512",
    PAGE_CHANGE_HTTP_TIMEOUT_MS: "1500",
  });
  try {
    const declared = await fetch(`${ceiling.base}${PAGE_CHANGE_MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: ACCEPT, "content-length": "1024" },
      body: Buffer.alloc(1024, 0x61),
    });
    assert.equal(declared.status, 413);
    assert.equal((await declared.json()).code, "payload_too_large");
    const started = performance.now();
    const chunked = streamMcp(ceiling.base);
    chunked.request.write(Buffer.alloc(1024, 0x61));
    const chunkedResponse = await chunked.result;
    assert.equal(chunkedResponse.status, 413);
    assert.equal(chunkedResponse.json.code, "payload_too_large");
    assert.ok(performance.now() - started < 1000);
    chunked.request.destroy();
  } finally {
    await ceiling.close();
  }

  const shared = await listenProfile({ ...enabledEnv, PAGE_CHANGE_HTTP_MAX_CONCURRENT: "1" });
  try {
    const held = streamMcp(shared.base);
    held.request.write("{");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const busy = await postRpc(shared.base, {
      jsonrpc: "2.0",
      id: "busy",
      method: "initialize",
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "busy", version: "0" } },
    });
    assert.equal(busy.response.status, 503);
    assert.equal(busy.json.code, "page_change_busy");
    held.request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const session = await connectClient(shared.base);
    try {
      const recovered = await session.client.callTool({
        name: PAGE_CHANGE_MCP_TOOL,
        arguments: pageChangeRequestExample(),
      });
      assert.notEqual(recovered.isError, true);
      assert.equal(toolJson(recovered).report.verdict, "changed");
    } finally {
      await session.close();
    }
  } finally {
    await shared.close();
  }

  const sleepWorker = path.join(cwd, "page-change-http-sleep-worker.mjs");
  const deadline = await listenProfile({
    ...enabledEnv,
    PAGE_CHANGE_HTTP_TIMEOUT_MS: "450",
    PAGE_CHANGE_HTTP_WORKER_PATH: sleepWorker,
  });
  try {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: "deadline",
      method: "tools/call",
      params: { name: PAGE_CHANGE_MCP_TOOL, arguments: { before: { title: "a" }, after: { title: "a" }, fields: ["title"] } },
    });
    const started = performance.now();
    const slow = streamMcp(deadline.base);
    slow.request.write(payload.slice(0, 24));
    await new Promise((resolve) => setTimeout(resolve, 300));
    slow.request.end(payload.slice(24));
    const timed = await slow.result;
    assert.notEqual(timed.status, 503);
    assert.equal(refusalCode(timed), "compare_timeout");
    assert.ok(performance.now() - started < 700, `deadline elapsed ${performance.now() - started}`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(ownedPageChangeWorkerCount(), 0);
    assert.equal(spawnSync("pgrep", ["-P", String(process.pid), "-f", "page-change-http"], { encoding: "utf8" }).status, 1);
  } finally {
    await deadline.close();
  }

  const disconnect = await listenProfile({
    ...enabledEnv,
    PAGE_CHANGE_HTTP_MAX_CONCURRENT: "1",
    PAGE_CHANGE_HTTP_TIMEOUT_MS: "5000",
    PAGE_CHANGE_HTTP_WORKER_PATH: sleepWorker,
  });
  try {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: "gone",
      method: "tools/call",
      params: { name: PAGE_CHANGE_MCP_TOOL, arguments: { before: { title: "a" }, after: { title: "a" }, fields: ["title"] } },
    });
    const abandoned = streamMcp(disconnect.base);
    abandoned.request.end(payload);
    await new Promise((resolve) => setTimeout(resolve, 40));
    abandoned.request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(ownedPageChangeWorkerCount(), 0);
    const again = streamMcp(disconnect.base);
    const started = performance.now();
    again.request.end(payload);
    const retried = await again.result;
    assert.notEqual(retried.status, 503);
    assert.equal(refusalCode(retried), "compare_timeout");
    assert.ok(performance.now() - started < 6500);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(ownedPageChangeWorkerCount(), 0);
    assert.equal(spawnSync("pgrep", ["-P", String(process.pid), "-f", "page-change-http"], { encoding: "utf8" }).status, 1);
  } finally {
    await disconnect.close();
  }

  const rated = globalThis.pageChangeProfile.base;
  for (let n = 0; n < 13; n += 1) {
    const response = await postRpc(rated, {
      jsonrpc: "2.0",
      id: n,
      method: "initialize",
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "rate", version: "0" } },
    });
    assert.notEqual(response.response.status, 429, `call ${n}`);
    assert.equal(response.response.status, 200, `call ${n}`);
  }
});

test("page-change MCP journal records this route and not the paid catalog bucket", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "page-change-mcp-journal-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const telemetry = createCommerceTelemetry({ dataDir, secret: "fixture-secret" });
  const observe = telemetry.freePageChangeObserver("mcp", { route: PAGE_CHANGE_MCP_PATH });
  const registered = await telemetry.snapshot({ days: 1 });
  assert.equal(registered.freePageChange.transports.mcp.captureStartedAt, null);
  assert.equal(registered.freePageChange.transports.http.captureStartedAt, null);
  assert.equal(typeof registered.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].captureStartedAt, "string");
  const profile = await listenProfile(enabledEnv, observe);
  t.after(() => profile.close());
  const session = await connectClient(profile.base);
  try {
    await session.client.listTools();
    await telemetry.flush();
    let before = "";
    try { before = (await readFile(telemetry.paths.currentPath, "utf8")).trim(); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    assert.equal(before, "");
    const input = pageChangeRequestExample();
    const compared = await session.client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: input });
    assert.notEqual(compared.isError, true);
    assert.equal(toolJson(compared).report.verdict, "changed");
  } finally {
    await session.close();
  }
  const broken = await postRpc(profile.base, "{");
  assert.equal(broken.response.status, 400);
  const unknown = await postRpc(profile.base, {
    jsonrpc: "2.0",
    id: "extract",
    method: "tools/call",
    params: { name: "extract", arguments: { url: "https://example.invalid/paid" } },
  });
  assert.equal(unknown.json.error.code, -32602);
  const sleep = await listenProfile({
    ...enabledEnv,
    PAGE_CHANGE_HTTP_TIMEOUT_MS: "5000",
    PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "page-change-http-sleep-worker.mjs"),
  }, observe);
  t.after(() => sleep.close());
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: "abort",
    method: "tools/call",
    params: { name: PAGE_CHANGE_MCP_TOOL, arguments: { before: { title: "a" }, after: { title: "a" }, fields: ["title"] } },
  });
  const abandoned = streamMcp(sleep.base);
  abandoned.request.end(payload);
  await new Promise((resolve) => setTimeout(resolve, 40));
  abandoned.request.destroy();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await telemetry.flush();
  const stored = await readFile(telemetry.paths.currentPath, "utf8");
  assert.equal(stored.includes("Synthetic title"), false);
  assert.equal(stored.includes("https://synthetic.example.invalid/page"), false);
  const rows = stored.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(rows.every((row) => row.route === PAGE_CHANGE_MCP_PATH));
  assert.ok(rows.every((row) => row.pageChangeOutcome.transport === "page-change-mcp"));
  assert.ok(rows.every((row) => row.kind === "free" && row.paymentPresent === false && row.queryKeys.length === 0));
  assert.equal(rows.filter((row) => row.pageChangeOutcome.outcome === "changed").length, 1);
  assert.ok(rows.some((row) => row.pageChangeOutcome.outcome === "refused"));
  assert.ok(rows.some((row) => row.pageChangeOutcome.outcome === "aborted"));
  assert.equal(Object.hasOwn(rows.find((row) => row.pageChangeOutcome.outcome === "changed"), "pageChangeRefusal"), false);
  assert.ok(rows.some((row) => row.pageChangeRefusal?.stage === "parser" && row.pageChangeRefusal?.reason === "invalid_json"));
  assert.ok(rows.some((row) => row.pageChangeRefusal?.stage === "parser" && row.pageChangeRefusal?.reason === "unknown_tool"));
  assert.ok(rows.filter((row) => row.pageChangeOutcome.outcome === "aborted").every((row) => row.pageChangeRefusal?.stage === "transport" && row.pageChangeRefusal?.reason === "aborted"));
  assert.equal(stored.includes("https://example.invalid"), false);
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.freePageChange.transports.mcp.observations, 0);
  assert.equal(snapshot.freePageChange.transports.mcp.captureStartedAt, null);
  assert.equal(snapshot.freePageChange.transports.mcp.byOutcome.changed, 0);
  assert.equal(snapshot.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].byOutcome.changed, 1);
  assert.ok(snapshot.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].byOutcome.refused >= 1);
  assert.ok(snapshot.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].byOutcome.aborted >= 1);
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("disabled profile records admission/disabled and a hostile worker code is not stored", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "page-change-refusal-profile-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const telemetry = createCommerceTelemetry({ dataDir, secret: "fixture-secret" });
  const observe = telemetry.freePageChangeObserver("mcp", { route: PAGE_CHANGE_MCP_PATH });
  const disabled = await listenProfile({}, observe);
  t.after(() => disabled.close());
  const session = await connectClient(disabled.base);
  try {
    const result = await session.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: {}, after: {}, fields: ["title"] },
    });
    assert.equal(result.isError, true);
    assert.equal(toolJson(result).error, "page_change_http_disabled");
  } finally {
    await session.close();
  }
  const previousSleep = process.env.PAGE_CHANGE_HTTP_SLEEP_MS;
  process.env.PAGE_CHANGE_HTTP_SLEEP_MS = "0";
  t.after(() => {
    if (previousSleep === undefined) delete process.env.PAGE_CHANGE_HTTP_SLEEP_MS;
    else process.env.PAGE_CHANGE_HTTP_SLEEP_MS = previousSleep;
  });
  const hostile = await listenProfile({
    PAGE_CHANGE_HTTP_ENABLED: "1",
    PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "page-change-http-sleep-worker.mjs"),
  }, observe);
  t.after(() => hostile.close());
  const hostileSession = await connectClient(hostile.base);
  try {
    const slept = await hostileSession.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: { title: "a" }, after: { title: "b" }, fields: ["title"] },
    });
    assert.equal(slept.isError, true);
    assert.equal(toolJson(slept).code, "sleep_elapsed");
  } finally {
    await hostileSession.close();
  }
  const outside = await listenProfile({
    PAGE_CHANGE_HTTP_ENABLED: "1",
    PAGE_CHANGE_HTTP_WORKER_PATH: "/tmp/h84010-not-a-worker.mjs",
  }, observe);
  t.after(() => outside.close());
  const outsideSession = await connectClient(outside.base);
  try {
    const rejected = await outsideSession.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: { title: "a" }, after: { title: "b" }, fields: ["title"] },
    });
    assert.equal(rejected.isError, true);
    assert.equal(toolJson(rejected).code, "invalid_worker_path");
  } finally {
    await outsideSession.close();
  }
  await telemetry.flush();
  const stored = await readFile(telemetry.paths.currentPath, "utf8");
  assert.equal(stored.includes("sleep_elapsed"), false);
  assert.equal(stored.includes("should have been killed"), false);
  assert.equal(stored.includes("/tmp/h84010-not-a-worker.mjs"), false);
  assert.equal(stored.includes("title"), false);
  const parsed = stored.trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(parsed.some((row) => row.pageChangeRefusal?.stage === "admission" && row.pageChangeRefusal?.reason === "disabled"));
  assert.ok(parsed.some((row) => row.pageChangeOutcome.outcome === "refused" && !row.pageChangeRefusal));
  assert.ok(parsed.some((row) => row.pageChangeRefusal?.stage === "core" && row.pageChangeRefusal?.reason === "compare_failed"));
  const snapshot = await telemetry.snapshot({ days: 1 });
  const reasons = snapshot.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].refusals.external.byReason;
  assert.equal(reasons["admission.disabled"], 1);
  assert.equal(reasons["core.compare_failed"], 1);
  assert.equal(snapshot.freePageChange.transports.mcp.observations, 0);
  assert.equal(JSON.stringify(snapshot.freePageChange).includes("sleep_elapsed"), false);
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
    const summary = await (await fetch(`${merchant.base}/v0/commerce-demand.json`)).json();
    assert.equal(summary.freePageChange.transports.mcp.byOutcome.changed, 0);
    assert.equal(summary.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].byOutcome.changed, 1);
    assert.ok(summary.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].byOutcome.refused >= 2);
    const stored = await readFile(path.join(merchant.dataDir, "commerce-events.ndjson"), "utf8");
    assert.equal(stored.includes("Alpha v1"), false);
    assert.equal(stored.includes("6122072a04e1bce878c1a0bd9ad758cafc2f9416263113367bc7b4dc0b9c2554"), false);
  } finally {
    await free.close();
    await paid.close();
    await sink.close();
    await merchant.close();
  }
  assert.equal(merchant.child.exitCode !== null || merchant.child.signalCode !== null, true);
  await assert.rejects(() => fetch(`${merchant.base}/mcp`));
});

test("mounted MCP aliases retain the free parser and recover with a useful comparison", { timeout: 30000 }, async () => {
  const merchant = await startMerchant();
  try {
    for (const route of ["/mcp/page-change", "/mcp/page-change/", "/MCP/PAGE-CHANGE"]) {
      const request = { jsonrpc: "2.0", id: 81, method: "tools/call",
        params: { name: PAGE_CHANGE_MCP_TOOL, arguments: pageChangeRequestExample() } };
      const response = await fetch(merchant.base + route, { method: "POST",
        headers: { "content-type": "application/json", accept: ACCEPT, "user-agent": "SameDayDesk-owner-receiving" },
        body: JSON.stringify(request), signal: AbortSignal.timeout(7000) });
      assert.equal(response.status, 200, route);
      const rpc = parseRpcBody(await response.text());
      assert.equal(rpc?.result?.isError, undefined, route);
      assert.equal(toolJson(rpc.result).report.verdict, "changed", route);
      const large = await fetch(merchant.base + route, { method: "POST",
        headers: { "content-type": "application/json", accept: ACCEPT },
        body: JSON.stringify({ jsonrpc: "2.0", id: 82, method: "tools/call",
          params: { name: "outside-free-profile", arguments: { text: "x".repeat(20000) } } }),
        signal: AbortSignal.timeout(7000) });
      assert.equal(large.status, 200, route + " must not use the ordinary16KiB parser");
      assert.equal(parseRpcBody(await large.text())?.error?.code, -32602, route);
    }
  } finally { await merchant.close(); }
});
