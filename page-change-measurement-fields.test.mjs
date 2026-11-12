// Additive measurement fields: occurredAt, discoveryBasis, entrySurface.
// The unit tests below need no dependencies. The mounted-server tests need
// express and the MCP SDK and skip without them (run after npm ci).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PAGE_CHANGE_DEPLOYMENT_MARKER_ENV,
  PAGE_CHANGE_DISCOVERY_BASIS_KINDS,
  issuePageChangeContinuation,
  pageChangeDiscovery,
  pageChangeDiscoveryWithBasis,
  pageChangeEntrySurface,
  pageChangeMeasurementRecord,
  pageChangeRefererEvidence,
  readPageChangeContinuationRequest,
  verifyPageChangeContinuationToken,
} from "./page-change-continuation.mjs";
import { readFreeMeasurement } from "./caller-result-client/src/free-continuation.mjs";
import * as portable from "./packages/task-continuation/index.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const C1 = path.join(ROOT, "examples/customer-x402/fixtures/page-change/c1");
const ENV = Object.freeze({ PAGE_CHANGE_CONTINUATION_TEST_KEY: "1" });
// The free page-change profile is off unless PAGE_CHANGE_HTTP_ENABLED is set
// (page-change-http.mjs isPageChangeHttpEnabled), so a mounted server needs it.
const MOUNT_ENV = Object.freeze({ ...ENV, PAGE_CHANGE_HTTP_ENABLED: "1" });
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0, 0);
const after = JSON.parse(await readFile(path.join(C1, "after.json"), "utf8"));
const FIELDS = ["title", "description"];
const NEW_KEYS = ["correlationId", "discovery", "discoveryBasis", "entrySurface", "kind", "occurredAt", "outcome", "step", "tool", "v"];
const req = (headers) => ({ headers: { host: "agents.samedaydesk.com", ...headers } });

test("positive: occurredAt is the injected server clock, entry surface and basis are runtime facts", () => {
  const issued = issuePageChangeContinuation({ after, fields: FIELDS, env: ENV, nowMs: T0 });
  const { discovery, discoveryBasis } = pageChangeDiscoveryWithBasis({ observed: pageChangeRefererEvidence(req({ referer: "https://agents.samedaydesk.com/llms.txt" })), declared: "cli" });
  const hosted = pageChangeEntrySurface({ env: { [PAGE_CHANGE_DEPLOYMENT_MARKER_ENV]: "d-123" } });
  const record = pageChangeMeasurementRecord({ correlationId: issued.correlationId, step: 0, discovery, outcome: "changed", nowMs: T0, discoveryBasis, entrySurface: hosted });
  assert.deepEqual(Object.keys(record).sort(), NEW_KEYS);
  assert.deepEqual(Object.keys(record).slice(0, 7), ["v", "kind", "tool", "correlationId", "step", "discovery", "outcome"]);
  assert.equal(record.occurredAt, "2026-11-12T12:00:00.000Z");
  assert.deepEqual(record.discovery, { status: "observed", source: "llms" });
  assert.deepEqual(record.discoveryBasis, { kind: "request_referer", matched: "/llms.txt" });
  assert.deepEqual(record.entrySurface, { surface: "hosted", basis: "deployment_marker", transport: "mcp_streamable_http" });
  assert.equal(JSON.stringify(record).includes("d-123"), false, "deployment id value is never copied");
  assert.equal(JSON.stringify(record).includes(issued.token), false);
  assert.equal(/"(token|kid|continuation)"/.test(JSON.stringify(record)), false);
  assert.deepEqual(pageChangeEntrySurface({ env: {} }), { surface: "installed", basis: "no_deployment_marker", transport: "mcp_streamable_http" });
  assert.deepEqual(pageChangeEntrySurface({ transport: "cli" }), { surface: "installed", basis: "local_cli", transport: "cli" });
  for (const [path, source] of [["/skill.md", "skill"], ["/SKILL.md", "skill"], ["/.well-known/agent-card.json", "a2a"], ["/.well-known/agent.json", "a2a"]]) {
    assert.deepEqual(pageChangeRefererEvidence(req({ referer: `https://agents.samedaydesk.com${path}?q=secret#frag` })), { source, basis: { kind: "request_referer", matched: path } });
  }
  assert.deepEqual(pageChangeRefererEvidence(req({ referer: "https://registry.modelcontextprotocol.io/v0/servers?search=x" })), { source: "registry", basis: { kind: "request_referer", matched: "registry.modelcontextprotocol.io" } });
  // declared and unknown keep their status and source; the basis is additive.
  assert.deepEqual(pageChangeDiscoveryWithBasis({ declared: "a2a" }), { discovery: { status: "declared", source: "a2a" }, discoveryBasis: { kind: "caller_meta", matched: null } });
  assert.deepEqual(pageChangeDiscoveryWithBasis({}), { discovery: { status: "unknown", source: null }, discoveryBasis: null });
  // A legacy mount hook that returns a bare source is still observed.
  assert.deepEqual(pageChangeDiscoveryWithBasis({ observed: "mcp" }).discoveryBasis, { kind: "mount_hook", matched: null });
  assert.deepEqual(PAGE_CHANGE_DISCOVERY_BASIS_KINDS, ["request_referer", "mount_hook", "caller_meta"]);
});

test("failure: observed never comes from the caller, a foreign referer or raw input", () => {
  // Caller-declared value alone is declared, never observed, whatever it names.
  for (const declared of ["llms", "registry", "skill"]) {
    assert.equal(pageChangeDiscoveryWithBasis({ declared }).discovery.status, "declared");
  }
  const refused = [
    {},
    { referer: "https://evil.example/llms.txt" },
    { referer: "https://agents.samedaydesk.com/other" },
    { referer: "https://agents.samedaydesk.com/llms.txt/" },
    { referer: "javascript:alert(1)" },
    { referer: "not a url" },
    { referer: `https://agents.samedaydesk.com/llms.txt?${"x".repeat(3000)}` },
    { referer: "https://registry.modelcontextprotocol.io.evil.example/" },
  ];
  for (const headers of refused) assert.equal(pageChangeRefererEvidence(req(headers)), null, JSON.stringify(headers).slice(0, 80));
  assert.equal(pageChangeRefererEvidence({ headers: { referer: "https://agents.samedaydesk.com/llms.txt" } }), null, "no Host, no same-host match");
  assert.equal(pageChangeRefererEvidence(null), null);
  // A caller cannot assert entry surface, basis or time through _meta.
  for (const extra of [{ entrySurface: { surface: "hosted" } }, { discoveryBasis: { kind: "request_referer" } }, { occurredAt: "2020-01-01T00:00:00.000Z" }, { discovery: "llms", observed: true }]) {
    assert.equal(readPageChangeContinuationRequest({ "samedaydesk/continuation": { save: true }, "samedaydesk/measurement": extra }).invalid, true, JSON.stringify(extra));
  }
  // Entry surface ignores request facts entirely and a blank marker is not hosted.
  assert.equal(pageChangeEntrySurface({ env: { [PAGE_CHANGE_DEPLOYMENT_MARKER_ENV]: "  " } }).surface, "installed");
  // A bad injected occurredAt falls back to the clock, never to caller text.
  assert.equal(pageChangeMeasurementRecord({ correlationId: "ae:corr:v1:AAAAAAAAAAAAAAAAAAAAAA", step: 0, occurredAt: "yesterday", nowMs: T0 }).occurredAt, "2026-11-12T12:00:00.000Z");
  assert.equal(pageChangeMeasurementRecord({ correlationId: "ae:corr:v1:AAAAAAAAAAAAAAAAAAAAAA", step: 0, occurredAt: "2026-02-30T00:00:00.000Z", nowMs: T0 }).occurredAt, "2026-11-12T12:00:00.000Z");
  // The client reader drops anything outside the documented shapes.
  const read = readFreeMeasurement({ structuredContent: { measurement: {
    v: 1, kind: "measurement", tool: "compare_page_observations", correlationId: "ae:corr:v1:AAAAAAAAAAAAAAAAAAAAAA", step: 0,
    discovery: { status: "observed", source: "llms" }, outcome: null, occurredAt: "soon",
    discoveryBasis: { kind: "guess", matched: "x" }, entrySurface: { surface: "cloud", basis: "deployment_marker", transport: "cli" },
  } } });
  assert.equal(read.occurredAt, null);
  assert.equal(read.discoveryBasis, null);
  assert.equal(read.entrySurface, null);
});

test("recovery: a continued step keeps the correlationId and gets a new occurredAt", () => {
  const first = issuePageChangeContinuation({ after, fields: FIELDS, env: ENV, nowMs: T0 });
  const step0 = pageChangeMeasurementRecord({ correlationId: first.correlationId, step: first.step, discovery: pageChangeDiscovery({ declared: "cli" }), nowMs: T0 });
  const previous = verifyPageChangeContinuationToken(first.token, { env: ENV, correlationId: first.correlationId, nowMs: T0 + 1000 });
  const attempts = [T0 + 5000, T0 + 9000].map((nowMs) => {
    const next = issuePageChangeContinuation({ after, fields: FIELDS, previous, env: ENV, nowMs });
    return pageChangeMeasurementRecord({ correlationId: next.correlationId, step: next.step, discovery: pageChangeDiscovery(), nowMs });
  });
  for (const record of attempts) {
    assert.equal(record.correlationId, step0.correlationId);
    assert.equal(record.step, 1);
    assert.notEqual(record.occurredAt, step0.occurredAt);
  }
  // A retried step after a lost reply is the same step with its own time; no exactly-once claim.
  assert.notEqual(attempts[0].occurredAt, attempts[1].occurredAt);
  assert.deepEqual(attempts[0].discoveryBasis, null);
});

test("CLI measurement line carries the new fields and keeps the correlationId across steps", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "sdd-measure-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = path.join(ROOT, "examples/customer-x402/bin/page-change.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, "compare", ...args], { cwd: dir, encoding: "utf8" });
  const line = (result) => JSON.parse(result.stderr.trim().split("\n").at(-1)).measurement;
  const first = run("--before", path.join(C1, "before.json"), "--after", path.join(C1, "after.json"), "--fields", "title,description", "--save-continuation", "chain.json", "--discovery", "cli");
  assert.equal(first.status, 0, first.stderr);
  const m0 = line(first);
  assert.deepEqual(Object.keys(m0).sort(), NEW_KEYS);
  assert.deepEqual(m0.entrySurface, { surface: "installed", basis: "local_cli", transport: "cli" });
  assert.deepEqual(m0.discoveryBasis, { kind: "caller_meta", matched: null });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = run("--continue", "chain.json", "--after", path.join(ROOT, "recipes/free-continuation/fixtures/next.json"), "--save-continuation", "chain-next.json");
  assert.equal(second.status, 0, second.stderr);
  const m1 = line(second);
  assert.equal(m1.correlationId, m0.correlationId);
  assert.equal(m1.step, 1);
  assert.ok(Date.parse(m1.occurredAt) > Date.parse(m0.occurredAt));
  assert.equal(m1.discoveryBasis, null);
});

const express = await import("express").catch(() => null);
const DEPS = express && await import("zod").catch(() => null) && await import("@modelcontextprotocol/sdk/server/mcp.js").catch(() => null)
  ? false : "needs express, zod and @modelcontextprotocol/sdk (run after npm ci)";

async function mounted(t, options) {
  const { mountPageChangeMcp } = await import("./page-change-mcp.mjs");
  const app = express.default();
  mountPageChangeMcp(app, options);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (body, headers = {}) => {
    const response = await fetch(`${base}/mcp/page-change`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
    const text = await response.text();
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5))).at(-1) ?? JSON.parse(text);
    return { data, base };
  };
}

const call = (id, args, meta) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "compare_page_observations", arguments: args, _meta: meta } });

test("shared shapes: the page-change emitter reuses the portable 1.3.0 enums and its records load there", () => {
  assert.equal(PAGE_CHANGE_DISCOVERY_BASIS_KINDS, portable.DISCOVERY_BASIS_KINDS);
  for (const env of [{ [PAGE_CHANGE_DEPLOYMENT_MARKER_ENV]: "d-1" }, {}]) {
    assert.deepEqual(pageChangeEntrySurface({ env }), portable.entrySurfaceFromRuntime({ env, markerEnv: PAGE_CHANGE_DEPLOYMENT_MARKER_ENV }));
  }
  assert.deepEqual(pageChangeEntrySurface({ transport: "cli" }), portable.entrySurfaceFromRuntime({ transport: "cli" }));
  const issued = issuePageChangeContinuation({ env: ENV, after, fields: FIELDS, nowMs: T0 });
  const cases = [
    pageChangeDiscoveryWithBasis({ observed: { source: "llms", basis: { kind: "request_referer", matched: "/llms.txt" } } }),
    pageChangeDiscoveryWithBasis({ observed: "mcp" }),
    pageChangeDiscoveryWithBasis({ declared: "cli" }),
    pageChangeDiscoveryWithBasis({}),
  ];
  for (const { discovery, discoveryBasis } of cases) {
    for (const env of [{ [PAGE_CHANGE_DEPLOYMENT_MARKER_ENV]: "d-1" }, {}]) {
      const record = pageChangeMeasurementRecord({ correlationId: issued.correlationId, step: issued.step, discovery, discoveryBasis, entrySurface: pageChangeEntrySurface({ env }), outcome: "changed", nowMs: T0 + 1000 });
      assert.deepEqual(portable.checkMeasurementRecord(record, { expiresAt: issued.expiresAt, nowMs: T0 + 1000 }), record);
    }
  }
});

test("mounted: referer gives observed with a basis, the marker gives hosted, the clock is injected", { skip: DEPS }, async (t) => {
  const { pageChangeMcpOutputSchema } = await import("./page-change-mcp-output-schema.mjs");
  const before = JSON.parse(await readFile(path.join(C1, "before.json"), "utf8"));
  const next = JSON.parse(await readFile(path.join(ROOT, "recipes/free-continuation/fixtures/next.json"), "utf8"));
  let clock = T0;
  const post = await mounted(t, { env: { ...MOUNT_ENV, [PAGE_CHANGE_DEPLOYMENT_MARKER_ENV]: "d-1" }, now: () => clock });
  const probe = await post(call(1, { before, after, fields: FIELDS }, { "samedaydesk/continuation": { save: true } }));
  const host = new URL(probe.base).host;
  const saved = await post(call(2, { before, after, fields: FIELDS }, { "samedaydesk/continuation": { save: true }, "samedaydesk/measurement": { discovery: "cli" } }), { referer: `http://${host}/llms.txt` });
  const content = saved.data.result.structuredContent;
  assert.equal(pageChangeMcpOutputSchema.safeParse(content).success, true);
  assert.deepEqual(content.measurement.discovery, { status: "observed", source: "llms" });
  assert.deepEqual(content.measurement.discoveryBasis, { kind: "request_referer", matched: "/llms.txt" });
  assert.deepEqual(content.measurement.entrySurface, { surface: "hosted", basis: "deployment_marker", transport: "mcp_streamable_http" });
  assert.equal(content.measurement.occurredAt, "2026-11-12T12:00:00.000Z");
  assert.equal(probe.data.result.structuredContent.measurement.discovery.status, "unknown");
  // Recovery: continue twice at later clock values; same correlationId, new occurredAt each time.
  const { token, correlationId } = content.continuation;
  for (const at of [T0 + 60_000, T0 + 120_000]) {
    clock = at;
    const continued = await post(call(3, { before: after, after: next, fields: FIELDS }, { "samedaydesk/continuation": { token, correlationId, save: true } }));
    const measurement = continued.data.result.structuredContent.measurement;
    assert.equal(measurement.correlationId, correlationId);
    assert.equal(measurement.step, 1);
    assert.equal(measurement.occurredAt, new Date(at).toISOString());
    assert.deepEqual(measurement.discovery, { status: "unknown", source: null });
  }
});

test("mounted: no marker is installed, and a foreign referer with a declared value stays declared", { skip: DEPS }, async (t) => {
  const before = JSON.parse(await readFile(path.join(C1, "before.json"), "utf8"));
  const post = await mounted(t, { env: { ...MOUNT_ENV } });
  const saved = await post(call(1, { before, after, fields: FIELDS }, { "samedaydesk/continuation": { save: true }, "samedaydesk/measurement": { discovery: "llms" } }), { referer: "https://evil.example/llms.txt" });
  const measurement = saved.data.result.structuredContent.measurement;
  assert.deepEqual(measurement.discovery, { status: "declared", source: "llms" });
  assert.deepEqual(measurement.discoveryBasis, { kind: "caller_meta", matched: null });
  assert.deepEqual(measurement.entrySurface, { surface: "installed", basis: "no_deployment_marker", transport: "mcp_streamable_http" });
  const invalid = await post(call(2, { before, after, fields: FIELDS }, { "samedaydesk/continuation": { save: true }, "samedaydesk/measurement": { entrySurface: { surface: "hosted" } } }));
  assert.equal(invalid.data.result.isError, true);
  assert.equal(JSON.parse(invalid.data.result.content[0].text).code, "continuation_invalid");
});
