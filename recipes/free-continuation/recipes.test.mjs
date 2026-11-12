// Drift check for the free continuation recipes. Dependency-free by default:
// it reads every marked block in the recipes and checks it against the real
// continuation module, CLI, client helpers, Python script and jq commands.
// Subtests that need zod, the MCP SDK or express skip when those packages are
// not installed (the shared authoring host has none); run them on a VM after
// `npm ci` for the schema, A2A builder, live Streamable HTTP and stdio checks.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PAGE_CHANGE_CONTINUATION_META,
  PAGE_CHANGE_CONTINUATION_REFUSAL_CODES,
  PAGE_CHANGE_CONTINUATION_TOOL,
  PAGE_CHANGE_CORRELATION_RE,
  PAGE_CHANGE_DISCOVERY_SOURCES,
  PAGE_CHANGE_MEASUREMENT_META,
  PageChangeContinuationError,
  bindPageChangeContinuation,
  issuePageChangeContinuation,
  pageChangeContinuationEventId,
  pageChangeContinuationRefusalBody,
  pageChangeDiscovery,
  pageChangeMeasurementRecord,
  readPageChangeContinuationRequest,
  verifyPageChangeContinuationToken,
} from "../../page-change-continuation.mjs";
import {
  FREE_CONTINUATION_FILE_SCHEMA,
  freeContinuationFileStore,
  freeContinuationMeta,
  freeObservationDigest,
} from "../../caller-result-client/src/free-continuation.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const C1 = path.join(ROOT, "examples/customer-x402/fixtures/page-change/c1");
const NEXT = path.join(HERE, "fixtures/next.json");
const OTHER = path.join(HERE, "fixtures/other-sources.json");
const CLI = path.join(ROOT, "examples/customer-x402/bin/page-change.mjs");
const PY = path.join(HERE, "free_continuation.py");
const RECIPES = ["node-cli.md", "node-mcp-sdk.md", "python.md", "curl-http.md", "a2a.md"];
const ENV = Object.freeze({ PAGE_CHANGE_CONTINUATION_TEST_KEY: "1" });
const FIELDS = ["title", "description"];
const ACCEPT = "application/json, text/event-stream";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const FIX = {
  "@c1/before.json": await readJson(path.join(C1, "before.json")),
  "@c1/after.json": await readJson(path.join(C1, "after.json")),
  "@fixtures/next.json": await readJson(NEXT),
  "@fixtures/other-sources.json": await readJson(OTHER),
};

// Server constants read from source text, so this file needs no zod.
const httpSource = await readFile(path.join(ROOT, "page-change-http.mjs"), "utf8");
const PRODUCT = httpSource.match(/export const PAGE_CHANGE_HTTP_PRODUCT = "([^"]+)"/)[1];
const SCHEMA_VERSION = httpSource.match(/export const PAGE_CHANGE_HTTP_SCHEMA = "([^"]+)"/)[1];

const BLOCK_RE = /<!-- check: ([a-z0-9-]+)(?: ([A-Za-z0-9_-]+))? -->\n```([a-z]+)\n([\s\S]*?)\n```/g;
const recipes = Object.fromEntries(await Promise.all(RECIPES.map(async (name) => [name, await readFile(path.join(HERE, name), "utf8")])));
const blocks = Object.entries(recipes).flatMap(([file, text]) => [...text.matchAll(BLOCK_RE)].map(([, kind, name = null, lang, body]) => ({ file, kind, name, lang, body })));
const of = (kind, file = null) => blocks.filter((block) => block.kind === kind && (!file || block.file === file));
const one = (kind, name, file = null) => {
  const found = blocks.filter((block) => block.kind === kind && block.name === name && (!file || block.file === file));
  assert.equal(found.length, 1, `${file ?? "*"} ${kind} ${name}`);
  return found[0];
};
const json = (block) => JSON.parse(block.body);

function substitute(value, vars = {}) {
  if (typeof value === "string") {
    if (Object.hasOwn(FIX, value)) return structuredClone(FIX[value]);
    if (value === "$TOKEN" && vars.token) return vars.token;
    if (value === "$CORRELATION_ID" && vars.correlationId) return vars.correlationId;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, substitute(child, vars)]));
  return value;
}

const paramsOf = (block, vars) => {
  const value = substitute(json(block), vars);
  return block.kind === "mcp-request" ? value.params : value;
};

function refusalCode(fn) {
  try { fn(); } catch (error) { assert.ok(error instanceof PageChangeContinuationError, String(error)); return error.code; }
  return null;
}

// Same order as admitContinuation in page-change-mcp.mjs, minus the compare.
function serverAdmit(params) {
  const request = readPageChangeContinuationRequest(params._meta);
  if (!request || request.invalid) return { code: "continuation_invalid" };
  if (request.token === null) return { request, previous: null };
  const code = refusalCode(() => bindPageChangeContinuation(
    verifyPageChangeContinuationToken(request.token, { env: ENV, correlationId: request.correlationId }), params.arguments,
  ));
  if (code) return { code };
  return { request, previous: verifyPageChangeContinuationToken(request.token, { env: ENV, correlationId: request.correlationId }) };
}

function startChain() {
  return issuePageChangeContinuation({ after: FIX["@c1/after.json"], fields: FIELDS, env: ENV });
}

async function scratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "sdd-recipes-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 60_000, ...options });
}

const has = (command) => run(command, ["--version"]).status === 0;
async function optional(specifier) {
  try { return await import(specifier); } catch { return null; }
}

test("every recipe shows three paths and states the rules, with no em dash and no internal name", async () => {
  for (const [file, text] of Object.entries(recipes)) {
    for (const heading of ["## Positive path", "## Failure path", "## Recovery path"]) assert.ok(text.includes(heading), `${file} ${heading}`);
    assert.match(text, /no exactly-once delivery/i, file);
    assert.match(text, /ae:corr:v1/, file);
    assert.match(text, /non-authorizing/, file);
    assert.ok(text.includes('_meta["samedaydesk/measurement"]'), file);
    assert.match(text, /token is never logged/, file);
  }
  const all = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "__pycache__") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else all.push([full, await readFile(full, "utf8")]);
    }
  };
  await walk(HERE);
  for (const [file, text] of all) {
    assert.equal(text.includes("\u2014"), false, `em dash in ${file}`);
    assert.equal(/\bPilot\b/.test(text), false, `internal name in ${file}`);
  }
  assert.match(await readFile(path.join(HERE, "README.md"), "utf8"), /SameDayDesk/);
});

test("every request block is a compare call the server admits", () => {
  const requests = [...of("mcp-request"), ...of("mcp-params")];
  assert.equal(requests.length, 10);
  const issued = startChain();
  const vars = { token: issued.token, correlationId: issued.correlationId };
  for (const block of requests) {
    const label = `${block.file} ${block.name}`;
    const raw = json(block);
    if (block.kind === "mcp-request") {
      assert.equal(raw.jsonrpc, "2.0", label);
      assert.equal(raw.method, "tools/call", label);
      assert.ok(Number.isSafeInteger(raw.id), label);
      assert.deepEqual(Object.keys(raw).sort(), ["id", "jsonrpc", "method", "params"], label);
    }
    const params = paramsOf(block, vars);
    assert.deepEqual(Object.keys(params).sort(), ["_meta", "arguments", "name"], label);
    assert.equal(params.name, PAGE_CHANGE_CONTINUATION_TOOL, label);
    assert.deepEqual(Object.keys(params.arguments).sort(), ["after", "before", "fields"], label);
    assert.deepEqual(params.arguments.fields, FIELDS, label);
    for (const key of Object.keys(params._meta)) assert.ok([PAGE_CHANGE_CONTINUATION_META, PAGE_CHANGE_MEASUREMENT_META].includes(key), label);
    const request = readPageChangeContinuationRequest(params._meta);
    assert.equal(request.invalid, false, label);
    assert.equal(request.save, true, label);
    const continuation = params._meta[PAGE_CHANGE_CONTINUATION_META];
    assert.equal(Object.hasOwn(continuation, "discovery"), false, `${label}: discovery beside the token`);
    const declared = params._meta[PAGE_CHANGE_MEASUREMENT_META]?.discovery ?? null;
    if (declared !== null) assert.ok(PAGE_CHANGE_DISCOVERY_SOURCES.includes(declared), label);
    assert.equal(request.declared, declared, label);
    if (/save/.test(block.name)) assert.equal(request.token, null, label);
    else {
      assert.equal(request.token, issued.token, label);
      assert.match(request.correlationId, PAGE_CHANGE_CORRELATION_RE, label);
    }
  }
  // The shipped Node helper builds the same _meta the recipes show.
  assert.deepEqual(freeContinuationMeta({ discovery: "mcp" }), paramsOf(one("mcp-params", "save", "node-mcp-sdk.md"))._meta);
  assert.deepEqual(freeContinuationMeta({ token: issued.token, correlationId: issued.correlationId }), paramsOf(one("mcp-params", "continue", "node-mcp-sdk.md"), vars)._meta);
});

test("positive, failure and recovery paths hold against the continuation module", () => {
  const families = [
    ["node-mcp-sdk.md", "mcp-params", "continue", "refuse"],
    ["curl-http.md", "mcp-request", "continue", "refuse"],
    ["a2a.md", "mcp-params", "continue-a2a", null],
    ["python.md", "mcp-request", "continue-python", null],
  ];
  for (const [file, kind, continueName, refuseName] of families) {
    const issued = startChain();
    const vars = { token: issued.token, correlationId: issued.correlationId };
    const admitted = serverAdmit(paramsOf(one(kind, continueName, file), vars));
    assert.equal(admitted.code, undefined, `${file} continue refused with ${admitted.code}`);
    const next = issuePageChangeContinuation({ after: FIX["@fixtures/next.json"], fields: FIELDS, previous: admitted.previous, env: ENV });
    assert.equal(next.correlationId, issued.correlationId);
    assert.equal(next.step, 1);
    // Recovery: the same request again, from the unchanged saved record.
    const again = serverAdmit(paramsOf(one(kind, continueName, file), vars));
    assert.equal(again.code, undefined);
    const retried = issuePageChangeContinuation({ after: FIX["@fixtures/next.json"], fields: FIELDS, previous: again.previous, env: ENV });
    assert.equal(retried.correlationId, next.correlationId);
    assert.equal(retried.step, next.step);
    assert.equal(pageChangeContinuationEventId(again.previous.correlationId, again.previous.step), pageChangeContinuationEventId(admitted.previous.correlationId, admitted.previous.step));
    if (refuseName) {
      const [refusalBlock] = of("mcp-refusal", file);
      const refusal = json(refusalBlock);
      assert.equal(serverAdmit(paramsOf(one(kind, refuseName, file), vars)).code, refusal.code, file);
    }
    // A correlationId alone never continues a chain.
    const stranger = startChain();
    const forged = paramsOf(one(kind, continueName, file), { token: stranger.token, correlationId: issued.correlationId });
    assert.equal(serverAdmit(forged).code, "continuation_correlation_mismatch");
  }
});

test("refusal blocks are the server's exact refusal bodies", () => {
  const refusals = of("mcp-refusal");
  assert.ok(refusals.length >= 3);
  for (const block of refusals) {
    const body = json(block);
    assert.ok(PAGE_CHANGE_CONTINUATION_REFUSAL_CODES.includes(body.code), block.file);
    assert.equal(block.name, body.code, block.file);
    assert.deepEqual(body, pageChangeContinuationRefusalBody(body.code, { product: PRODUCT, schemaVersion: SCHEMA_VERSION }), block.file);
    assert.equal(body.charged, false);
    assert.equal(body.paymentRequired, false);
    assert.equal(body.nextMethod, "tools/call");
  }
});

test("success shape and A2A follow-up keep the token and discovery apart", () => {
  const issued = startChain();
  const vars = { token: issued.token, correlationId: issued.correlationId };
  const success = substitute(json(one("success-shape", null)), vars);
  assert.equal(success.ok, true);
  assert.equal(success.charged, false);
  assert.deepEqual(Object.keys(success.continuation).sort(), Object.keys(issued).sort());
  assert.deepEqual(success.continuation.next, issued.next);
  assert.equal(success.continuation.tool, issued.tool);
  assert.equal(success.continuation.v, issued.v);
  const record = pageChangeMeasurementRecord({ correlationId: issued.correlationId, step: 0, discovery: pageChangeDiscovery({ declared: "mcp" }), outcome: "changed" });
  assert.deepEqual(success.measurement, record);
  assert.equal(Object.hasOwn(success.continuation, "discovery"), false);

  const followup = substitute(json(one("a2a-followup", null)), vars);
  const [part1, part2] = followup.message.parts;
  assert.notEqual(followup.taskId, followup.message.referenceTaskIds[0]);
  assert.equal(followup.contextId, followup.message.contextId);
  assert.deepEqual(Object.keys(part1.data.continuation).sort(), ["correlationId", "step", "token"]);
  assert.equal(part1.data.continuation.token, issued.token);
  assert.deepEqual(part2.data.measurement, pageChangeMeasurementRecord({ correlationId: issued.correlationId, step: 0, discovery: pageChangeDiscovery({ declared: "a2a" }), outcome: "changed" }));
  assert.equal(/"(token|kid|continuation)"/.test(JSON.stringify(part2)), false);
});

test("node CLI recipe runs: save, continue, typed refusal, and recovery after a lost reply", async (t) => {
  const dir = await scratch(t);
  const cliArgs = (name) => {
    const line = one("cli-args", name, "node-cli.md").body.split("&&")[0].trim();
    const words = line.split(/\s+/).map((word) => word.replace("$CLI", CLI).replace("$C1", C1).replace("$NEXT", NEXT));
    assert.equal(words[0], "node");
    return words.slice(1);
  };
  const cliSource = await readFile(CLI, "utf8");
  for (const flag of ["--continue", "--save-continuation", "--discovery", "--before", "--after", "--fields"]) assert.ok(cliSource.includes(`"${flag}"`), flag);

  const saved = run(process.execPath, cliArgs("save"), { cwd: dir });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).verdict, "changed");
  const chain = await readJson(path.join(dir, "chain.json"));
  assert.equal((await stat(path.join(dir, "chain.json"))).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(chain), Object.keys(json(one("saved-file", null, "node-cli.md"))));
  assert.equal(chain.token, null);
  const measurementLine = JSON.parse(saved.stderr.trim().split("\n").at(-1));
  assert.deepEqual(measurementLine, substitute(json(one("cli-measurement", null, "node-cli.md")), { correlationId: chain.correlationId }));

  const refused = run(process.execPath, cliArgs("refuse"), { cwd: dir });
  assert.equal(refused.status, 2);
  assert.deepEqual(JSON.parse(refused.stderr.trim()), json(one("cli-refusal", null, "node-cli.md")));
  assert.deepEqual(await readJson(path.join(dir, "chain.json")), chain);

  // Lost reply: run the same continue twice from the untouched chain.json.
  const results = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const continued = run(process.execPath, cliArgs("continue"), { cwd: dir });
    assert.equal(continued.status, 0, continued.stderr);
    results.push(await readJson(path.join(dir, "chain-next.json")));
  }
  assert.equal(results[0].correlationId, chain.correlationId);
  assert.equal(results[0].step, 1);
  assert.deepEqual(results[1], results[0]);
});

test("Node client recipe: argument order and the saved record match the shipped client", async (t) => {
  const source = await readFile(path.join(ROOT, "caller-result-client/bin/continue-free.mjs"), "utf8");
  assert.ok(source.includes('action === "start" && files.length === 5'));
  assert.ok(source.includes('action === "continue" && files.length === 2'));
  for (const name of ["start", "continue"]) {
    const words = one("continue-free-args", name, "node-mcp-sdk.md").body.trim().split(/\s+/);
    const flag = words.indexOf("--discovery");
    if (flag !== -1) words.splice(flag, 2);
    assert.equal(words[2], name);
    assert.equal(words.length - 3, name === "start" ? 5 : 2, name);
  }
  const issued = startChain();
  const dir = await scratch(t);
  const store = freeContinuationFileStore(path.join(dir, "chain.json"));
  const example = json(one("saved-file", null, "node-mcp-sdk.md"));
  const { schema, tool, ...rest } = example;
  await store.save({ ...rest, observationSha256: freeObservationDigest(FIX["@c1/after.json"]), token: issued.token, correlationId: issued.correlationId, expiresAt: issued.expiresAt });
  const written = await readJson(store.path);
  assert.deepEqual(Object.keys(written), Object.keys(example));
  assert.equal(written.schema, FREE_CONTINUATION_FILE_SCHEMA);
  assert.equal(schema, FREE_CONTINUATION_FILE_SCHEMA);
  assert.equal(tool, PAGE_CHANGE_CONTINUATION_TOOL);
});

test("Python recipe: compiles, builds the documented requests, and shares the record digest", { skip: has("python3") ? false : "python3 not on this host" }, async (t) => {
  const dir = await scratch(t);
  const compiled = run("python3", ["-m", "py_compile", PY], { env: { ...process.env, PYTHONPYCACHEPREFIX: path.join(dir, "pyc") } });
  assert.equal(compiled.status, 0, compiled.stderr);
  const pyArgs = (name) => one("python-args", name, "python.md").body.trim().split(/\s+/).slice(2)
    .map((word) => word.replace("$C1", C1).replace("recipes/free-continuation/fixtures", path.join(HERE, "fixtures")).replace('"$SDD_MCP_URL"', "http://127.0.0.1:9/mcp/page-change"));
  const start = run("python3", [PY, ...pyArgs("start"), "--dry-run"], { cwd: dir });
  assert.equal(start.status, 0, start.stderr);
  assert.deepEqual(JSON.parse(start.stdout), substitute(json(one("mcp-request", "save-python", "python.md"))));

  const digest = run("python3", ["-c", `import json,sys; sys.path.insert(0, ${JSON.stringify(HERE)}); import free_continuation as f; print(json.dumps([f.digest(json.load(open(p))) for p in sys.argv[1:]]))`,
    path.join(C1, "before.json"), path.join(C1, "after.json"), NEXT], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(digest.status, 0, digest.stderr);
  assert.deepEqual(JSON.parse(digest.stdout), [FIX["@c1/before.json"], FIX["@c1/after.json"], FIX["@fixtures/next.json"]].map(freeObservationDigest));

  const issued = startChain();
  await writeFile(path.join(dir, "chain.json"), `${JSON.stringify({
    schema: FREE_CONTINUATION_FILE_SCHEMA, tool: PAGE_CHANGE_CONTINUATION_TOOL, endpointUrl: "http://127.0.0.1:9/mcp/page-change", fields: FIELDS,
    observationPath: path.join(C1, "after.json"), observationSha256: freeObservationDigest(FIX["@c1/after.json"]),
    token: issued.token, correlationId: issued.correlationId, step: 0, expiresAt: issued.expiresAt,
  })}\n`, { mode: 0o600 });
  const cont = run("python3", [PY, ...pyArgs("continue"), "--dry-run"], { cwd: dir });
  assert.equal(cont.status, 0, cont.stderr);
  assert.equal(cont.stdout.includes(issued.token), false, "dry run printed the token");
  assert.deepEqual(JSON.parse(cont.stdout), substitute(json(one("mcp-request", "continue-python", "python.md")), { correlationId: issued.correlationId }));
  const refuse = run("python3", [PY, ...pyArgs("refuse"), "--dry-run"], { cwd: dir });
  assert.equal(refuse.status, 0, refuse.stderr);
  const refusedParams = JSON.parse(refuse.stdout).params;
  refusedParams._meta[PAGE_CHANGE_CONTINUATION_META].token = issued.token;
  assert.equal(serverAdmit(refusedParams).code, json(one("mcp-refusal", "continuation_subject_mismatch", "python.md")).code);
  // A held observation that changed is refused locally, before any send.
  await writeFile(path.join(dir, "edited.json"), JSON.stringify({ ...FIX["@c1/after.json"], jobId: "edited" }));
  const edited = JSON.parse(await readFile(path.join(dir, "chain.json"), "utf8"));
  await writeFile(path.join(dir, "chain.json"), JSON.stringify({ ...edited, observationPath: path.join(dir, "edited.json") }), { mode: 0o600 });
  const changed = run("python3", [PY, "continue", "chain.json", NEXT, "--dry-run"], { cwd: dir });
  assert.equal(changed.status, 2);
  assert.equal(changed.stderr.trim(), "held_observation_changed");
});

test("curl recipe: jq builds the documented requests and the shared record", { skip: has("jq") && has("sha256sum") && has("realpath") ? false : "jq, sha256sum or realpath not on this host" }, async (t) => {
  const dir = await scratch(t);
  const issued = startChain();
  const shellEnv = { ...process.env, C1, NEXT, SDD_MCP_URL: "http://127.0.0.1:9/mcp/page-change" };
  const sh = (script) => run("bash", ["-euo", "pipefail", "-c", script], { cwd: dir, env: shellEnv });
  const prelude = recipes["curl-http.md"].match(/```sh\n(C1=[\s\S]*?)\n```/)[1].split("\n").filter((line) => !/^(C1|NEXT)=/.test(line)).join("\n");

  const built = sh(one("jq-build", "save", "curl-http.md").body);
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(await readJson(path.join(dir, "save.json")), substitute(json(one("mcp-request", "save", "curl-http.md"))));

  // Stand-in reply with the real continuation shape; the post line itself needs a server.
  await writeFile(path.join(dir, "reply.json"), JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: { ok: true, charged: false, continuation: issued } } }));
  const saveScript = one("jq-save", null, "curl-http.md").body.split("\n").filter((line) => line.trim() !== "post save.json").join("\n");
  const saved = sh(`${prelude}\n${saveScript}`);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.stdout.includes(issued.token), false, "the token reached stdout");
  const chain = await readJson(path.join(dir, "chain.json"));
  assert.equal((await stat(path.join(dir, "chain.json"))).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(chain), Object.keys(json(one("saved-file", null, "node-mcp-sdk.md"))));
  assert.equal(chain.observationSha256, freeObservationDigest(FIX["@c1/after.json"]));
  assert.equal(chain.token, issued.token);

  const cont = sh(one("jq-build", "continue", "curl-http.md").body);
  assert.equal(cont.status, 0, cont.stderr);
  assert.deepEqual(await readJson(path.join(dir, "continue.json")), substitute(json(one("mcp-request", "continue", "curl-http.md")), { token: issued.token, correlationId: issued.correlationId }));
});

// ---- Needs repo dependencies (npm ci). Skipped on a host without them. ----

const zod = await optional("zod");
const sdkClient = await optional("@modelcontextprotocol/sdk/client/index.js");
const express = await optional("express");
const DEPS = zod && sdkClient && express ? false : "needs zod, @modelcontextprotocol/sdk and express (run after npm ci)";

test("request arguments validate against the MCP input schema", { skip: DEPS }, async () => {
  const { pageChangeMcpToolConfig } = await import("../../page-change-mcp.mjs");
  const input = zod.z.object(pageChangeMcpToolConfig().inputSchema);
  const issued = startChain();
  for (const block of [...of("mcp-request"), ...of("mcp-params")]) {
    const parsed = input.safeParse(paramsOf(block, { token: issued.token, correlationId: issued.correlationId }).arguments);
    assert.equal(parsed.success, true, `${block.file} ${block.name}`);
  }
});

test("A2A follow-up equals buildFreeCompareContinuationTask and the card lists the free skill", { skip: DEPS }, async () => {
  const { buildAgentCard, buildFreeCompareContinuationTask, freePageCompareContinuationRecipe } = await import("../../a2a-storefront.mjs");
  const issued = startChain();
  const block = substitute(json(one("a2a-followup", null)), { token: issued.token, correlationId: issued.correlationId });
  const prior = { id: block.message.referenceTaskIds[0], contextId: block.contextId, status: { state: "TASK_STATE_COMPLETED" } };
  const built = buildFreeCompareContinuationTask(prior, { data: block.message.parts[0].data, measurement: block.message.parts[1].data.measurement, taskId: block.taskId, messageId: block.message.messageId });
  assert.deepEqual(JSON.parse(JSON.stringify(built)), block);
  assert.equal(freePageCompareContinuationRecipe("https://agents.samedaydesk.com").a2a.artifactLineage, "client_side");
  const card = buildAgentCard({ publicUrl: "https://agents.samedaydesk.com", serviceVersion: "1", actions: [], freePageCompare: true });
  const skill = card.skills.find((item) => item.id === "compare-held-page-observations");
  assert.ok(skill);
  assert.match(skill.description, /\/mcp\/page-change/);
});

function lastRpc(text) {
  const lines = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  for (const raw of (lines.length ? lines : [text]).reverse()) {
    try { const message = JSON.parse(raw); if (message.result || message.error) return message; } catch { /* next */ }
  }
  return null;
}

test("live Streamable HTTP round trip: recipes, Python and the Node client against a mounted server", { skip: DEPS }, async (t) => {
  const { mountPageChangeMcp } = await import("../../page-change-mcp.mjs");
  const { pageChangeMcpOutputSchema } = await import("../../page-change-mcp-output-schema.mjs");
  const app = express.default();
  mountPageChangeMcp(app, { env: { ...ENV } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/mcp/page-change`;
  const post = async (body) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: ACCEPT }, body: JSON.stringify(body) });
    return lastRpc(await response.text());
  };
  const save = await post(substitute(json(one("mcp-request", "save", "curl-http.md"))));
  const content = save.result.structuredContent;
  assert.equal(pageChangeMcpOutputSchema.safeParse(content).success, true);
  assert.equal(content.charged, false);
  assert.deepEqual(content.measurement.discovery, { status: "declared", source: "llms" });
  assert.equal(content.measurement.outcome, json(one("success-shape", null)).measurement.outcome);
  const vars = { token: content.continuation.token, correlationId: content.continuation.correlationId };
  const continued = await post(substitute(json(one("mcp-request", "continue", "curl-http.md")), vars));
  assert.equal(continued.result.structuredContent.continuation.step, 1);
  const retried = await post(substitute(json(one("mcp-request", "continue", "curl-http.md")), vars));
  assert.equal(retried.result.structuredContent.continuation.step, 1);
  assert.equal(retried.result.structuredContent.continuation.correlationId, vars.correlationId);
  const refused = await post(substitute(json(one("mcp-request", "refuse", "curl-http.md")), vars));
  assert.equal(refused.result.isError, true);
  assert.deepEqual(JSON.parse(refused.result.content[0].text), json(one("mcp-refusal", "continuation_observation_mismatch", "curl-http.md")));

  const dir = await scratch(t);
  if (has("python3")) {
    const py = (...args) => run("python3", [PY, ...args], { cwd: dir });
    const start = py("start", url, path.join(C1, "before.json"), path.join(C1, "after.json"), "title,description", "py-chain.json", "--discovery", "other");
    assert.equal(start.status, 0, start.stderr);
    const pyChain = await readJson(path.join(dir, "py-chain.json"));
    assert.equal(start.stdout.includes(pyChain.token), false);
    assert.equal(py("continue", "py-chain.json", OTHER).status, 2);
    assert.equal(py("continue", "py-chain.json", NEXT).status, 0);
    assert.equal((await readJson(path.join(dir, "py-chain.json"))).step, 1);
  }
  const node = (...args) => run(process.execPath, [path.join(ROOT, "caller-result-client/bin/continue-free.mjs"), ...args], { cwd: dir });
  const nodeStart = node("start", url, path.join(C1, "before.json"), path.join(C1, "after.json"), "title,description", "node-chain.json", "--discovery", "mcp");
  assert.equal(nodeStart.status, 0, nodeStart.stderr);
  const nodeChain = await readJson(path.join(dir, "node-chain.json"));
  assert.equal(nodeStart.stdout.includes(nodeChain.token), false);
  assert.equal(node("continue", "node-chain.json", NEXT).status, 0);
  if (has("python3")) {
    // Cross-runtime: Python continues the chain the Node client saved.
    const cross = run("python3", [PY, "continue", "node-chain.json", path.join(HERE, "fixtures/next.json")], { cwd: dir });
    assert.notEqual(cross.status, 3, cross.stderr);
  }
});

test("stdio probe lists the same tool and refuses to compare", { skip: DEPS }, async () => {
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new sdkClient.Client({ name: "samedaydesk-recipes", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "page-change-mcp-stdio-probe.mjs")], cwd: ROOT }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [PAGE_CHANGE_CONTINUATION_TOOL]);
    const result = await client.callTool({ name: PAGE_CHANGE_CONTINUATION_TOOL, arguments: { before: FIX["@c1/before.json"], after: FIX["@c1/after.json"], fields: FIELDS } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /stdio_probe_does_not_compare/);
  } finally {
    await client.close();
  }
});
