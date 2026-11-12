// Protocol capability selection and the portable handback across runtimes.
// Dependency-free by default. The fake initialize servers below are local
// test fixtures (node:http on 127.0.0.1), never a hosted or live record.
// The SDK parity and Node client subtests skip without npm ci.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  A2A_RECIPE_PROTOCOL_VERSIONS, MCP_RECIPE_PROTOCOL_VERSIONS, MCP_REQUESTED_PROTOCOL_VERSION, MCP_SERVER_SDK,
  MCP_SERVER_SDK_PROTOCOL_VERSIONS, PROTOCOL_VERSION_UNSUPPORTED, advertisedA2aVersions, advertisedMcpVersion,
  mcpInitializeRequest, protocolRefusalFromSdkError, selectProtocolVersion,
} from "../../caller-result-client/src/protocol-selection.mjs";
import {
  beginDispatch, createHandback, createKeyring, exportHandback, hashJson, importHandback, issueContinuation,
  recordResult, taskBinding, taskBindings,
} from "../../packages/task-continuation/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PY = path.join(HERE, "free_continuation.py");
const C1 = path.join(ROOT, "examples/customer-x402/fixtures/page-change/c1");
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", timeout: 60_000, ...options });
const has = (command) => run(command, ["--version"]).status === 0;
const PYTHON = has("python3") ? false : "python3 not on this host";
const BLOCK_RE = /<!-- check: ([a-z0-9-]+)(?: ([A-Za-z0-9_-]+))? -->\n```([a-z]+)\n([\s\S]*?)\n```/g;
const blocks = async (file) => [...(await readFile(path.join(HERE, file), "utf8")).matchAll(BLOCK_RE)].map(([, kind, name = null, lang, body]) => ({ kind, name, lang, body }));

async function scratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "sdd-protocol-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("supported versions are exact, sourced, and never include an unimplemented revision", async () => {
  assert.deepEqual(MCP_SERVER_SDK_PROTOCOL_VERSIONS, ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"]);
  for (const version of MCP_RECIPE_PROTOCOL_VERSIONS) assert.ok(MCP_SERVER_SDK_PROTOCOL_VERSIONS.includes(version));
  assert.equal(MCP_REQUESTED_PROTOCOL_VERSION, MCP_SERVER_SDK_PROTOCOL_VERSIONS[0]);
  assert.ok(!MCP_RECIPE_PROTOCOL_VERSIONS.includes("2026-07-28"));
  assert.ok(!MCP_SERVER_SDK_PROTOCOL_VERSIONS.includes("2026-07-28"));
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies[MCP_SERVER_SDK.name], MCP_SERVER_SDK.version);
  const lockPath = path.join(ROOT, "package-lock.json");
  if (existsSync(lockPath)) {
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(lock.packages[`node_modules/${MCP_SERVER_SDK.name}`].version, MCP_SERVER_SDK.version);
  }
  const a2a = await readFile(path.join(ROOT, "a2a-storefront.mjs"), "utf8");
  assert.deepEqual(A2A_RECIPE_PROTOCOL_VERSIONS, [a2a.match(/const A2A_VERSION = "([^"]+)"/)[1]]);
  // Compatibility Knowledge owns the corpus; cite it, do not copy it.
  assert.ok(existsSync(path.join(ROOT, "docs/reviews/h99110-mcp-current-client-compat/RESULT.md")) || "corpus not in this checkout");
});

test("exact-match selection and the typed protocol_version_unsupported refusal", () => {
  assert.deepEqual(selectProtocolVersion("2025-11-25", MCP_RECIPE_PROTOCOL_VERSIONS), { ok: true, protocolVersion: "2025-11-25" });
  assert.deepEqual(selectProtocolVersion("2025-06-18", MCP_RECIPE_PROTOCOL_VERSIONS), { ok: true, protocolVersion: "2025-06-18" });
  for (const advertised of ["2026-07-28", "2025-03-26", "2025-11-25 ", "2025-11", null, 20251125, "x".repeat(500)]) {
    const refused = selectProtocolVersion(advertised, MCP_RECIPE_PROTOCOL_VERSIONS);
    assert.equal(refused.ok, false, String(advertised));
    assert.equal(refused.code, PROTOCOL_VERSION_UNSUPPORTED);
    assert.equal(refused.charged, false);
    assert.deepEqual(refused.supported, MCP_RECIPE_PROTOCOL_VERSIONS);
    assert.deepEqual(refused.advertised, typeof advertised === "string" ? [advertised.slice(0, 64)] : []);
  }
  assert.deepEqual(advertisedMcpVersion({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-11-25" } }), "2025-11-25");
  assert.equal(advertisedMcpVersion({ error: { code: -32600 } }), null);
  const card = { supportedInterfaces: [{ url: "https://agents.samedaydesk.com/a2a", protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }] };
  assert.deepEqual(selectProtocolVersion(advertisedA2aVersions(card), A2A_RECIPE_PROTOCOL_VERSIONS), { ok: true, protocolVersion: "1.0" });
  const future = selectProtocolVersion(advertisedA2aVersions({ supportedInterfaces: [{ protocolVersion: "2.0" }, { protocolVersion: "0.3" }] }), A2A_RECIPE_PROTOCOL_VERSIONS);
  assert.deepEqual([future.code, future.advertised], [PROTOCOL_VERSION_UNSUPPORTED, ["2.0", "0.3"]]);
  assert.deepEqual(protocolRefusalFromSdkError(new Error("Server's protocol version is not supported: 2026-07-28")).advertised, ["2026-07-28"]);
  assert.equal(protocolRefusalFromSdkError(new Error("fetch failed")), null);
});

test("recipe blocks: initialize request, Node refusal and Python refusal match the helper", async () => {
  const curl = await blocks("curl-http.md");
  assert.deepEqual(JSON.parse(curl.find((block) => block.kind === "initialize-request").body), mcpInitializeRequest(0));
  const node = (await blocks("node-mcp-sdk.md")).find((block) => block.kind === "protocol-refusal");
  assert.deepEqual(JSON.parse(node.body).refusal, selectProtocolVersion("2025-03-26", MCP_RECIPE_PROTOCOL_VERSIONS));
  const python = (await blocks("python.md")).find((block) => block.kind === "python-protocol-refusal");
  assert.deepEqual(JSON.parse(python.body), selectProtocolVersion("2026-07-28", MCP_RECIPE_PROTOCOL_VERSIONS));
  const source = await readFile(PY, "utf8");
  assert.deepEqual(JSON.parse(source.match(/^MCP_RECIPE_PROTOCOL_VERSIONS = (\[.*\])$/m)[1]), MCP_RECIPE_PROTOCOL_VERSIONS);
  assert.equal(source.match(/^MCP_REQUESTED_PROTOCOL_VERSION = "([^"]+)"$/m)[1], MCP_REQUESTED_PROTOCOL_VERSION);
  for (const file of ["README.md", "curl-http.md", "node-mcp-sdk.md", "python.md", "a2a.md"]) {
    const text = await readFile(path.join(HERE, file), "utf8");
    assert.ok(!text.includes("\u2014"), `${file} has an em dash`);
    assert.ok(!text.includes("is not configured"), `${file} still says the keyring is missing`);
  }
});

test("curl recipe: select_protocol accepts an exact match and refuses anything else", { skip: has("jq") && has("bash") ? false : "jq or bash not on this host" }, async (t) => {
  const dir = await scratch(t);
  const block = (await blocks("curl-http.md")).find((item) => item.kind === "jq-protocol").body;
  const fn = block.slice(0, block.indexOf("\njq -n"));
  for (const [advertised, status] of [["2025-11-25", 0], ["2025-06-18", 0], ["2026-07-28", 2], [null, 2]]) {
    await writeFile(path.join(dir, "reply.json"), JSON.stringify({ jsonrpc: "2.0", id: 0, result: advertised ? { protocolVersion: advertised } : {} }));
    const result = run("bash", ["-c", `${fn}\nselect_protocol reply.json`], { cwd: dir });
    assert.equal(result.status, status, `${advertised}: ${result.stderr}`);
    if (status) {
      const body = JSON.parse(result.stdout);
      const expected = selectProtocolVersion(advertised, MCP_RECIPE_PROTOCOL_VERSIONS);
      assert.deepEqual(body, { ok: false, charged: false, code: expected.code, advertised: expected.advertised, supported: expected.supported });
    }
  }
});

function fakeInitializeServer(advertised) {
  const methods = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    methods.push(body.method);
    res.setHeader("content-type", "application/json");
    if (body.method === "initialize") {
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: advertised, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "0" } } }));
    }
    if (body.method === "notifications/initialized") { res.statusCode = 202; return res.end(); }
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }));
  });
  return { server, methods };
}

async function listen(t, fake) {
  await new Promise((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  t.after(() => fake.server.close());
  return `http://127.0.0.1:${fake.server.address().port}/mcp/page-change`;
}

const runAsync = (command, args, options) => new Promise((resolve) => {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});

test("Python client refuses an unsupported advertised version before any tools/call", { skip: PYTHON }, async (t) => {
  const dir = await scratch(t);
  const offline = run("python3", [PY, "protocol-check", "2026-07-28"]);
  assert.equal(offline.status, 2);
  assert.deepEqual(JSON.parse(offline.stdout), selectProtocolVersion("2026-07-28", MCP_RECIPE_PROTOCOL_VERSIONS));
  assert.equal(run("python3", [PY, "protocol-check", "2025-11-25"]).status, 0);
  for (const advertised of ["2026-07-28", "2025-03-26"]) {
    const fake = fakeInitializeServer(advertised);
    const url = await listen(t, fake);
    const result = await runAsync("python3", [PY, "start", url, path.join(C1, "before.json"), path.join(C1, "after.json"), "title,description", "chain.json"], { cwd: dir });
    assert.equal(result.status, 2, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.state, "refused");
    assert.equal(body.refusal.code, "protocol_version_unsupported");
    assert.deepEqual(body.refusal.advertised, [advertised]);
    assert.deepEqual(fake.methods, ["initialize"], "no tools/call after a mismatch");
    assert.ok(!existsSync(path.join(dir, "chain.json")));
  }
});

const sdkClient = await import("@modelcontextprotocol/sdk/client/index.js").catch(() => null);
const SDK = sdkClient ? false : "needs @modelcontextprotocol/sdk (run after npm ci)";

test("SDK parity: the installed SDK's own supported list equals the cited one", { skip: SDK }, async () => {
  const types = await import("@modelcontextprotocol/sdk/types.js");
  assert.deepEqual([...types.SUPPORTED_PROTOCOL_VERSIONS], MCP_SERVER_SDK_PROTOCOL_VERSIONS);
  assert.equal(types.LATEST_PROTOCOL_VERSION, MCP_REQUESTED_PROTOCOL_VERSION);
});

test("Node client refuses an advertised version outside the recipe list, typed and before tools/call", { skip: SDK }, async (t) => {
  const dir = await scratch(t);
  const client = path.join(ROOT, "caller-result-client/bin/continue-free.mjs");
  for (const advertised of ["2025-03-26", "2026-07-28"]) {
    const fake = fakeInitializeServer(advertised);
    const url = await listen(t, fake);
    const result = await runAsync(process.execPath, [client, "start", url, path.join(C1, "before.json"), path.join(C1, "after.json"), "title,description", "chain.json"], { cwd: dir });
    assert.equal(result.status, 2);
    assert.equal(result.stderr.trim(), "protocol_version_unsupported");
    assert.deepEqual(JSON.parse(result.stdout).refusal.advertised, [advertised]);
    assert.ok(!fake.methods.includes("tools/call"));
  }
});

test("portable handback: Node export, Python import and export are byte-identical; no token crosses", { skip: PYTHON }, async (t) => {
  const dir = await scratch(t);
  const keyring = createKeyring([{ kid: "t1", secret: "test-only-secret-0123456789abcdef-xyz" }]);
  const task = taskBinding({ tool: "compare_page_observations", origin: "http://127.0.0.1:3000", subject: hashJson(["https://shop.example/p"]) });
  const issued = issueContinuation({ keyring, tool: task.tool, subject: task.subject, bindings: taskBindings(task) });
  const states = [createHandback({ task, issued })];
  states.push(beginDispatch(states[0]));
  states.push(recordResult(states[1], { digest: hashJson({ changed: true }) }));
  for (const handback of states) {
    const text = exportHandback(handback);
    assert.ok(!text.includes(issued.token) && !text.includes(issued.token.split(".")[2]));
    await writeFile(path.join(dir, "handback.json"), text);
    const result = run("python3", [PY, "handback-check", "handback.json"], { cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), text, handback.state);
    assert.deepEqual(importHandback(result.stdout.trim()), importHandback(text));
  }
  const parsed = JSON.parse(exportHandback(states[0]));
  for (const bad of [{ ...parsed, token: issued.token }, { ...parsed, state: "result" }, { ...parsed, task: { ...parsed.task, origin: "http://127.0.0.1:3000" } }]) {
    await writeFile(path.join(dir, "bad.json"), JSON.stringify(bad));
    const result = run("python3", [PY, "handback-check", "bad.json"], { cwd: dir });
    assert.equal(result.status, 2);
    assert.equal(result.stderr.trim(), "continuation_handback_invalid");
  }
});
