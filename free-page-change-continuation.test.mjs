import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCommerceTelemetry } from "./commerce-events.mjs";
import { pageChangeRequestExample } from "./page-change-input-contract.mjs";
import { executePageChangeComparison, ownedPageChangeWorkerCount } from "./page-change-http.mjs";
import { PAGE_CHANGE_MCP_PATH, PAGE_CHANGE_MCP_TOOL, mountPageChangeMcp } from "./page-change-mcp.mjs";
import { pageChangeMcpOutputSchema } from "./page-change-mcp-output-schema.mjs";
import {
  PAGE_CHANGE_CONTINUATION_META,
  PAGE_CHANGE_CORRELATION_RE,
  issuePageChangeContinuation,
  newPageChangeCorrelationId,
  pageChangeContinuationKeyring,
  signPageChangeContinuationPayload,
} from "./page-change-continuation.mjs";
import {
  A2A_CATALOG_SKILL_ID,
  buildAgentCard,
  buildFreeCompareContinuationTask,
  freePageCompareContinuationRecipe,
} from "./a2a-storefront.mjs";

const OLD_KEY = `n12a:${"a".repeat(40)}`;
const NEW_KEY = `n12b:${"b".repeat(40)}`;
const env = { PAGE_CHANGE_HTTP_ENABLED: "1", PAGE_CHANGE_CONTINUATION_KEYS: `${NEW_KEY},${OLD_KEY}` };
const plainEnv = { PAGE_CHANGE_HTTP_ENABLED: "1" };
const SYNTHETIC_URL = "https://synthetic.example.invalid/page";
const BASE_KEYS = ["ok", "product", "schemaVersion", "charged", "report"];

function stable(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => (key === "elapsedMs" ? undefined : item)));
}

function chain() {
  const first = pageChangeRequestExample();
  const third = structuredClone(first.after);
  third.jobId = "3".repeat(64);
  third.sources[0].data.title = "Synthetic title third";
  const otherSource = structuredClone(third);
  otherSource.sources[0].source = "https://other.example.invalid/elsewhere";
  return { first, third, otherSource };
}

async function listen(serverEnv, options = {}) {
  const app = express();
  mountPageChangeMcp(app, { env: serverEnv, ...options });
  const server = createHttpServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: "free-page-change-continuation", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${PAGE_CHANGE_MCP_PATH}`)));
  await client.listTools();
  return {
    base,
    client,
    call(args, meta) {
      return client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: args, ...(meta ? { _meta: meta } : {}) });
    },
    async close() {
      await client.close();
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

const save = (discovery) => ({ [PAGE_CHANGE_CONTINUATION_META]: { save: true, ...(discovery ? { discovery } : {}) } });
const resume = (continuation, extra = {}) => ({
  [PAGE_CHANGE_CONTINUATION_META]: { token: continuation.token, correlationId: continuation.correlationId, ...extra },
});

function body(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  return { text, json: JSON.parse(text) };
}

function assertRefusal(result, code, secrets = []) {
  assert.equal(result.isError, true, code);
  assert.equal(result.structuredContent, undefined, code);
  const { text, json } = body(result);
  assert.equal(json.code, code);
  assert.equal(json.error, code);
  assert.equal(json.ok, false);
  assert.equal(json.charged, false);
  assert.equal(json.paymentRequired, false);
  assert.equal(json.nextMethod, "tools/call");
  assert.equal(json.nextTool, PAGE_CHANGE_MCP_TOOL);
  assert.equal(typeof json.nextStep, "string");
  assert.equal(Object.hasOwn(json, "continuation"), false);
  for (const key of ["settlementReference", "paymentIdentifier", "paymentActor", "price", "accepts"]) assert.equal(Object.hasOwn(json, key), false, key);
  for (const secret of [SYNTHETIC_URL, "Synthetic title", "other.example.invalid", "Bearer", ...secrets]) {
    assert.equal(text.includes(secret), false, `${code} echoed input`);
  }
  assert.equal(/\u2014/.test(text), false);
}

// Measurement refuses any record where discovery sits beside a bearer token.
function assertSeparated(structured) {
  const { continuation, measurement } = structured;
  assert.equal(Object.hasOwn(continuation, "discovery"), false);
  assert.deepEqual(Object.keys(measurement).sort(), ["correlationId", "discovery", "discoveryBasis", "entrySurface", "kind", "occurredAt", "outcome", "step", "tool", "v"]);
  assert.equal(measurement.kind, "measurement");
  assert.equal(measurement.correlationId, continuation.correlationId);
  assert.equal(measurement.step, continuation.step);
  assert.ok(["observed", "declared", "unknown"].includes(measurement.discovery.status));
  const text = JSON.stringify(measurement);
  assert.equal(text.includes(continuation.token), false);
  for (const part of continuation.token.split(".").slice(1)) assert.equal(text.includes(part), false);
  assert.equal(/"(token|continuation|kid)"\s*:/.test(text), false);
  return measurement;
}

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

test("old callers without a continuation get the unchanged output shape", { timeout: 60_000 }, async (t) => {
  const { first } = chain();
  const direct = await executePageChangeComparison(first, plainEnv, { timeoutMs: 8000 });
  for (const serverEnv of [plainEnv, env]) {
    const profile = await listen(serverEnv);
    t.after(() => profile.close());
    for (const meta of [undefined, { "other.example/meta": { keep: true } }]) {
      const result = await profile.call(first, meta);
      assert.notEqual(result.isError, true);
      const { text, json } = body(result);
      assert.deepEqual(Object.keys(json), BASE_KEYS);
      assert.deepEqual(Object.keys(result.structuredContent), BASE_KEYS);
      assert.deepEqual(stable(json), stable(direct));
      assert.equal(text, JSON.stringify(json));
      assert.equal(text.includes("continuation"), false);
    }
    const listed = await profile.client.listTools();
    assert.deepEqual(listed.tools[0].outputSchema.required, BASE_KEYS);
  }
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("measurement record is separate from the token, and the token object has no discovery", { timeout: 60_000 }, async (t) => {
  const { first } = chain();
  const profile = await listen(env);
  t.after(() => profile.close());
  const saved = await profile.call(first, save("registry"));
  const measurement = assertSeparated(saved.structuredContent);
  assert.match(measurement.correlationId, PAGE_CHANGE_CORRELATION_RE);
  assert.deepEqual(measurement.discovery, { status: "declared", source: "registry" });
  assert.equal(Object.hasOwn(measurement, "kid"), false);
  assert.equal(Object.hasOwn(measurement, "expiresAt"), false);
  assert.equal(pageChangeMcpOutputSchema.safeParse({ ...saved.structuredContent, continuation: { ...saved.structuredContent.continuation, discovery: measurement.discovery } }).success, false);
});

test("a cold caller saves, continues, and keeps one correlationId across steps", { timeout: 60_000 }, async (t) => {
  const { first, third } = chain();
  const profile = await listen(env);
  t.after(() => profile.close());
  const saved = await profile.call(first, save("a2a"));
  assert.notEqual(saved.isError, true);
  assert.equal(pageChangeMcpOutputSchema.safeParse(saved.structuredContent).success, true);
  const step0 = saved.structuredContent.continuation;
  assert.equal(saved.structuredContent.charged, false);
  assert.equal(step0.step, 0);
  assert.equal(step0.kid, "n12b");
  assert.match(step0.correlationId, PAGE_CHANGE_CORRELATION_RE);
  assert.deepEqual(assertSeparated(saved.structuredContent).discovery, { status: "declared", source: "a2a" });
  assert.equal(saved.structuredContent.measurement.outcome, "changed");
  assert.equal(step0.next.meta, PAGE_CHANGE_CONTINUATION_META);
  assert.ok(step0.token.length <= 1024);
  const payload = decodePayload(step0.token);
  const payloadText = JSON.stringify(payload);
  for (const leak of [step0.correlationId, SYNTHETIC_URL, "Synthetic title", "a2a", "declared"]) assert.equal(payloadText.includes(leak), false, leak);
  assert.equal(payload.tool, PAGE_CHANGE_MCP_TOOL);

  const continued = await profile.call({ before: first.after, after: third, fields: first.fields }, resume(step0));
  assert.notEqual(continued.isError, true, continued.content?.[0]?.text);
  assert.equal(pageChangeMcpOutputSchema.safeParse(continued.structuredContent).success, true);
  assert.equal(continued.structuredContent.report.verdict, "changed");
  const step1 = continued.structuredContent.continuation;
  assert.equal(step1.step, 1);
  assert.equal(step1.correlationId, step0.correlationId);
  assert.notEqual(step1.token, step0.token);
  // A token restore never carries discovery forward.
  assert.deepEqual(assertSeparated(continued.structuredContent).discovery, { status: "unknown", source: null });

  const noNext = await profile.call({ before: first.after, after: third, fields: first.fields }, resume(step0, { save: false }));
  assert.notEqual(noNext.isError, true);
  assert.deepEqual(Object.keys(noNext.structuredContent), BASE_KEYS);
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("discovery is observed only from server request evidence, never from the token", { timeout: 60_000 }, async (t) => {
  const { first, third } = chain();
  const observedProfile = await listen(env, { discoveryEvidence: (req) => (req.headers["x-test-surface"] === "mcp" ? "mcp" : null) });
  t.after(() => observedProfile.close());
  const saved = await observedProfile.call(first, save("cli"));
  assert.deepEqual(assertSeparated(saved.structuredContent).discovery, { status: "declared", source: "cli" });
  const declaredOnContinue = await observedProfile.call({ before: first.after, after: third, fields: first.fields }, {
    ...resume(saved.structuredContent.continuation),
    "samedaydesk/measurement": { discovery: "a2a" },
  });
  assert.deepEqual(assertSeparated(declaredOnContinue.structuredContent).discovery, { status: "declared", source: "a2a" });
  const plainProfile = await listen(env, { discoveryEvidence: () => "registry" });
  t.after(() => plainProfile.close());
  const restored = await plainProfile.call({ before: first.after, after: third, fields: first.fields }, resume(saved.structuredContent.continuation));
  assert.deepEqual(assertSeparated(restored.structuredContent).discovery, { status: "observed", source: "registry" });
  const undeclared = await observedProfile.call(first, save("not-a-label"));
  assert.deepEqual(assertSeparated(undeclared.structuredContent).discovery, { status: "unknown", source: null });
});

test("key rotation keeps an old kid valid and refuses an unknown kid", { timeout: 60_000 }, async (t) => {
  const { first, third } = chain();
  const profile = await listen(env);
  t.after(() => profile.close());
  const old = issuePageChangeContinuation({ after: first.after, fields: first.fields, env: { PAGE_CHANGE_CONTINUATION_KEYS: OLD_KEY } });
  assert.equal(old.kid, "n12a");
  const accepted = await profile.call({ before: first.after, after: third, fields: first.fields }, resume(old));
  assert.notEqual(accepted.isError, true, accepted.content?.[0]?.text);
  assert.equal(accepted.structuredContent.continuation.kid, "n12b");
  assert.equal(accepted.structuredContent.continuation.correlationId, old.correlationId);
  const stranger = issuePageChangeContinuation({ after: first.after, fields: first.fields, env: { PAGE_CHANGE_CONTINUATION_KEYS: `n12z:${"z".repeat(40)}` } });
  assertRefusal(await profile.call({ before: first.after, after: third, fields: first.fields }, resume(stranger)), "continuation_unknown_key", [stranger.token]);
});

test("refusals echo no input, give a nextMethod cue, and never fall back to payment", { timeout: 90_000 }, async (t) => {
  const { first, third, otherSource } = chain();
  const profile = await listen(env);
  t.after(() => profile.close());
  const saved = (await profile.call(first, save())).structuredContent.continuation;
  const next = { before: first.after, after: third, fields: first.fields };
  const flip = saved.token.slice(0, -3) + (saved.token.at(-3) === "A" ? "B" : "A") + saved.token.slice(-2);
  const expired = issuePageChangeContinuation({ after: first.after, fields: first.fields, env, nowMs: Date.now() - 400 * 24 * 3600 * 1000 });
  const key = pageChangeContinuationKeyring(env).current;
  const wrongTool = signPageChangeContinuationPayload({ ...decodePayload(saved.token), tool: "extract" }, key);
  const credential = structuredClone(first);
  credential.before.headers = { authorization: "Bearer abcdefghijklmnopqrstuvwxyz" };
  const cases = [
    ["continuation_token_invalid", next, resume({ ...saved, token: flip }), [flip]],
    ["continuation_token_oversized", next, resume({ ...saved, token: `pc1.${"A".repeat(2000)}.x` }), ["AAAAAAAAAA"]],
    ["continuation_expired", next, resume(expired), [expired.token]],
    ["continuation_wrong_tool", next, resume({ ...saved, token: wrongTool }), [wrongTool]],
    ["continuation_correlation_mismatch", next, resume({ ...saved, correlationId: newPageChangeCorrelationId() }), [saved.token]],
    ["continuation_subject_mismatch", { ...next, after: otherSource }, resume(saved), [saved.token]],
    ["continuation_fields_mismatch", { ...next, fields: ["title"] }, resume(saved), [saved.token]],
    ["continuation_observation_mismatch", { ...next, before: third }, resume(saved), [saved.token]],
    ["continuation_second_observation_incomplete", { ...next, after: { missing: true } }, resume(saved), [saved.token]],
    ["continuation_second_observation_incomplete", { before: first.before, after: { missing: true }, fields: first.fields }, save(), []],
    ["continuation_credential_input", credential, save(), ["abcdefghijklmnop"]],
    ["continuation_invalid", first, { [PAGE_CHANGE_CONTINUATION_META]: { save: true, extra: SYNTHETIC_URL } }, []],
    ["continuation_invalid", next, resume(saved, { discovery: "a2a" }), [saved.token]],
    ["continuation_invalid", first, { ...save(), "samedaydesk/measurement": { discovery: "a2a", token: "x" } }, []],
  ];
  for (const [code, args, meta, secrets] of cases) assertRefusal(await profile.call(args, meta), code, secrets);
  const off = await listen(plainEnv);
  t.after(() => off.close());
  const offBody = await off.call(first, save());
  assertRefusal(offBody, "continuation_unavailable");
  assert.match(body(offBody).json.nextStep, /without _meta/);
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("journal counts a retried continued step once and never stores or logs the token", { timeout: 90_000 }, async (t) => {
  const { first, third } = chain();
  const dataDir = await mkdtemp(path.join(tmpdir(), "free-page-change-continuation-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const telemetry = createCommerceTelemetry({ dataDir, secret: "fixture-secret" });
  const observe = telemetry.freePageChangeObserver("mcp", { route: PAGE_CHANGE_MCP_PATH });
  const profile = await listen(env, { observe });
  t.after(() => profile.close());
  const captured = [];
  const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info, write: process.stderr.write.bind(process.stderr), out: process.stdout.write.bind(process.stdout) };
  for (const name of ["log", "warn", "error", "info"]) console[name] = (...args) => { captured.push(args.map(String).join(" ")); };
  process.stderr.write = (chunk, ...rest) => { captured.push(String(chunk)); return originals.write(chunk, ...rest); };
  process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return originals.out(chunk, ...rest); };
  let tokens = [];
  try {
    const step0 = (await profile.call(first, save("mcp"))).structuredContent.continuation;
    const args = { before: first.after, after: third, fields: first.fields };
    const once = await profile.call(args, resume(step0));
    const retry = await profile.call(args, resume(step0));
    assert.notEqual(once.isError, true);
    assert.notEqual(retry.isError, true);
    assertRefusal(await profile.call({ ...args, fields: ["title"] }, resume(step0)), "continuation_fields_mismatch", [step0.token]);
    tokens = [step0.token, once.structuredContent.continuation.token, retry.structuredContent.continuation.token];
  } finally {
    Object.assign(console, { log: originals.log, warn: originals.warn, error: originals.error, info: originals.info });
    process.stderr.write = originals.write;
    process.stdout.write = originals.out;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await telemetry.flush();
  const stored = await readFile(telemetry.paths.currentPath, "utf8");
  const rows = stored.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.kind === "free" && row.paymentPresent === false && row.settlementReference === null));
  const changed = rows.filter((row) => row.pageChangeOutcome.outcome === "changed");
  assert.equal(changed.length, 3);
  assert.equal(new Set(changed.map((row) => row.id)).size, 2);
  const snapshot = await telemetry.snapshot({ days: 1 });
  assert.equal(snapshot.freePageChange.profiles[PAGE_CHANGE_MCP_PATH].byOutcome.changed, 2);
  assert.equal(snapshot.byResult?.paid_success || 0, 0);
  const everything = [stored, JSON.stringify(snapshot), ...captured].join("\n");
  for (const token of tokens) {
    assert.equal(everything.includes(token), false);
    assert.equal(everything.includes(token.split(".")[2]), false);
  }
  assert.equal(stored.includes(SYNTHETIC_URL), false);
});

test("correlationId has the shared ae:corr:v1 shape and is not in the token", () => {
  assert.equal(PAGE_CHANGE_CORRELATION_RE.source, "^ae:corr:v1:[A-Za-z0-9_-]{22}$");
  const seen = new Set();
  for (let index = 0; index < 64; index += 1) {
    const id = newPageChangeCorrelationId();
    assert.match(id, /^ae:corr:v1:[A-Za-z0-9_-]{22}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 64);
  const issued = issuePageChangeContinuation({ ...pageChangeRequestExample(), env });
  assert.match(issued.correlationId, /^ae:corr:v1:[A-Za-z0-9_-]{22}$/);
  assert.equal(issued.token.includes(issued.correlationId.slice(11)), false);
  assert.equal(JSON.stringify(decodePayload(issued.token)).includes(issued.correlationId), false);
});

test("A2A continuation is a new task in the same context and leaves the completed task unchanged", () => {
  const prior = {
    id: "task-1",
    contextId: "ctx-1",
    status: { state: "TASK_STATE_COMPLETED" },
    artifacts: [{ artifactId: "a1", parts: [{ data: { verdict: "changed" } }] }],
  };
  const before = JSON.stringify(prior);
  const measurement = { v: 1, kind: "measurement", tool: PAGE_CHANGE_MCP_TOOL, correlationId: newPageChangeCorrelationId(), step: 1, discovery: { status: "declared", source: "a2a" }, outcome: null };
  const next = buildFreeCompareContinuationTask(prior, {
    data: { continuation: { token: "pc1.redacted", correlationId: measurement.correlationId, step: 0 } },
    measurement,
  });
  assert.equal(next.message.parts.length, 2);
  assert.equal(Object.hasOwn(next.message.parts[0].data.continuation, "discovery"), false);
  assert.deepEqual(next.message.parts[1].data.measurement.discovery, { status: "declared", source: "a2a" });
  assert.throws(() => buildFreeCompareContinuationTask(prior, { data: { token: "pc1.redacted", discovery: measurement.discovery } }), /beside a token/);
  assert.throws(() => buildFreeCompareContinuationTask(prior, { data: {}, measurement: { ...measurement, token: "pc1.redacted" } }), /must not carry/);
  assert.equal(JSON.stringify(prior), before);
  assert.notEqual(next.taskId, prior.id);
  assert.equal(next.contextId, prior.contextId);
  assert.equal(next.message.contextId, prior.contextId);
  assert.deepEqual(next.message.referenceTaskIds, [prior.id]);
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.isFrozen(next.message), true);
  assert.throws(() => buildFreeCompareContinuationTask({ ...prior, status: { state: "TASK_STATE_WORKING" } }), /not terminal/);
  assert.throws(() => buildFreeCompareContinuationTask(prior, { taskId: prior.id }), /new taskId/);
  const recipe = freePageCompareContinuationRecipe("https://agents.example/any/path");
  assert.equal(recipe.charged, false);
  assert.equal(recipe.paymentRequired, false);
  assert.equal(recipe.endpoint.url, `https://agents.example${PAGE_CHANGE_MCP_PATH}`);
  assert.equal(recipe.a2a.completedTask, "immutable");
  assert.equal(recipe.a2a.taskId, "new_per_step");
  assert.equal(/\u2014/.test(JSON.stringify(recipe)), false);
  const card = buildAgentCard({ publicUrl: "https://agents.example", serviceVersion: "1", actions: [], freePageCompare: true });
  assert.equal(card.skills[0].id, A2A_CATALOG_SKILL_ID);
  assert.equal(JSON.stringify(card).includes(recipe.id), false);
});
