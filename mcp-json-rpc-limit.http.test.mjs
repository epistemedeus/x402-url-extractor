import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LOCKFILE_PIN_DELTA_MAX_REQUEST_BYTES } from "./lockfile-pin-delta-config.mjs";
import {
  MCP_CONTINUATION_OPERATION_MAX_BYTES,
  MCP_JSON_RPC_MAX_BYTES,
  MCP_JSON_RPC_OVERLIMIT_MESSAGE,
  MCP_TOOL_ARGUMENT_MAX_BYTES,
  ORDINARY_HTTP_JSON_MAX_BYTES,
} from "./mcp-json-rpc-limit.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function messageOfSize(bytes) {
  const message = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "opportunity_preflight", arguments: { pad: "" } } };
  const overhead = Buffer.byteLength(JSON.stringify(message));
  message.params.arguments.pad = "a".repeat(bytes - overhead);
  const raw = JSON.stringify(message);
  if (Buffer.byteLength(raw) !== bytes) throw new Error(`sized ${Buffer.byteLength(raw)} wanted ${bytes}`);
  return message;
}

test("the MCP JSON-RPC ceiling is the advertised argument budget plus one envelope allowance", () => {
  assert.equal(ORDINARY_HTTP_JSON_MAX_BYTES, 16 * 1024);
  assert.equal(MCP_TOOL_ARGUMENT_MAX_BYTES, LOCKFILE_PIN_DELTA_MAX_REQUEST_BYTES);
  assert.equal(MCP_JSON_RPC_MAX_BYTES, MCP_TOOL_ARGUMENT_MAX_BYTES + 32 * 1024);
  assert.ok(MCP_CONTINUATION_OPERATION_MAX_BYTES < MCP_JSON_RPC_MAX_BYTES);
  assert.ok(MCP_CONTINUATION_OPERATION_MAX_BYTES > ORDINARY_HTTP_JSON_MAX_BYTES);
  const argumentsBody = { before: { pad: "" }, after: {} };
  const empty = Buffer.byteLength(JSON.stringify(argumentsBody));
  argumentsBody.before.pad = "b".repeat(MCP_TOOL_ARGUMENT_MAX_BYTES - empty);
  const message = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "lockfile_pin_delta", arguments: argumentsBody,
    _meta: { "x402/payment": { x402Version: 2, accepted: { amount: "50000" } } } } };
  assert.equal(Buffer.byteLength(JSON.stringify(message.params.arguments)), MCP_TOOL_ARGUMENT_MAX_BYTES);
  const raw = Buffer.byteLength(JSON.stringify(message));
  assert.ok(raw > ORDINARY_HTTP_JSON_MAX_BYTES);
  assert.ok(raw <= MCP_JSON_RPC_MAX_BYTES);
});

test("mounted SDK requests accept the MCP byte ceiling and refuse one byte past it as JSON-RPC", { timeout: 60000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "mcp-json-limit-"));
  const probe = createServer();
  const port = await new Promise((resolve) => probe.listen(0, "127.0.0.1", () => resolve(probe.address().port)));
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(port),
      PUBLIC_URL: "https://agents.samedaydesk.com",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      EXTRACT_BATCH_ENABLED: "0",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 20000;
  while (!output.includes("MCP server:  POST /mcp")) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`startup failed ${output.slice(-1200)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}/mcp`;
  async function sdkPost(message) {
    const seen = [];
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const bytes = Buffer.from(await response.arrayBuffer());
        seen.push({
          requestBytes: Buffer.byteLength(init?.body || ""),
          status: response.status,
          contentType: response.headers.get("content-type"),
          body: bytes.toString("utf8"),
        });
        return new Response(bytes, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json" } });
      },
    });
    const client = new Client({ name: "mcp-limit", version: "0" });
    try {
      await client.connect(transport);
      if (message) await transport.send(message);
    } catch (error) {
      seen.at(-1).sdkError = String(error?.message || error).slice(0, 180);
    } finally {
      await client.close().catch(() => {});
    }
    return seen;
  }
  const below = await sdkPost(null);
  const initialize = below.find((row) => row.requestBytes > 0 && row.requestBytes < ORDINARY_HTTP_JSON_MAX_BYTES && row.status === 200);
  assert.ok(initialize, JSON.stringify(below.map((row) => [row.requestBytes, row.status])));
  assert.match(initialize.body, /jsonrpc/);
  const posted = async (bytes) => (await sdkPost(messageOfSize(bytes))).find((row) => row.requestBytes === bytes);
  const above = await posted(20 * 1024);
  assert.ok(above.requestBytes > ORDINARY_HTTP_JSON_MAX_BYTES);
  assert.equal(above.status, 200);
  assert.equal(above.body.includes("PayloadTooLargeError"), false);
  assert.match(above.body, /jsonrpc/);
  const exact = await posted(MCP_JSON_RPC_MAX_BYTES);
  assert.equal(exact.requestBytes, MCP_JSON_RPC_MAX_BYTES);
  assert.equal(exact.status, 200);
  assert.match(exact.body, /jsonrpc/);
  assert.equal(exact.body.includes(MCP_JSON_RPC_OVERLIMIT_MESSAGE), false);
  const over = await posted(MCP_JSON_RPC_MAX_BYTES + 1);
  assert.equal(over.requestBytes, MCP_JSON_RPC_MAX_BYTES + 1);
  assert.equal(over.status, 200);
  assert.deepEqual(JSON.parse(over.body), { jsonrpc: "2.0", error: { code: -32600, message: MCP_JSON_RPC_OVERLIMIT_MESSAGE, data: { maxBytes: MCP_JSON_RPC_MAX_BYTES } }, id: null });
  const invalid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: "{" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { ok: false, error: "invalid_json", charged: false });
  const descriptor = await (await fetch(url)).json();
  assert.equal(descriptor.jsonRpc.maxBytes, MCP_JSON_RPC_MAX_BYTES);
  assert.equal(descriptor.jsonRpc.toolArgumentMaxBytes, MCP_TOOL_ARGUMENT_MAX_BYTES);
  assert.equal(descriptor.jsonRpc.ordinaryHttpJsonMaxBytes, ORDINARY_HTTP_JSON_MAX_BYTES);
  const shell = Buffer.byteLength('{"pad":""}');
  const ordinaryOk = await fetch(`http://127.0.0.1:${port}/extract`, { method: "POST", headers: { "content-type": "application/json" },
    body: `{"pad":"${"c".repeat(ORDINARY_HTTP_JSON_MAX_BYTES - shell)}"}` });
  assert.notEqual(ordinaryOk.status, 413);
  await ordinaryOk.arrayBuffer();
  const ordinaryOver = await fetch(`http://127.0.0.1:${port}/extract`, { method: "POST", headers: { "content-type": "application/json" },
    body: `{"pad":"${"c".repeat(ORDINARY_HTTP_JSON_MAX_BYTES - shell + 1)}"}` });
  assert.equal(ordinaryOver.status, 413);
  await ordinaryOver.arrayBuffer();
});
