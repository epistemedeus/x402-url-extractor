// task-continuation 1.3.0 consumer contract. Dependency-free: node --test.
// The issuer used here is a local fixture (node:http on 127.0.0.1) that holds
// test keys; nothing here is a hosted or live record.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ERROR_CODES, ERROR_MESSAGES, HANDBACK_SCHEMA, HANDBACK_STATES, MODULE_VERSION,
  DISCOVERY_BASIS_KINDS, ENTRY_BASES, ENTRY_SURFACES, ENTRY_TRANSPORTS,
  acquireDiscovery, advanceHandback, applyReadback, assertResumable, assertSameTask, beginDispatch,
  checkHandback, checkMeasurementRecord, createHandback, createKeyring, entrySurfaceFromRuntime, exportHandback,
  hashJson, importHandback, issueContinuation, loadHandbackFile, markResultUnknown, measurementRecord,
  nextHandbackStep, observedIsProven, recordResult, refusal, saveContinuationFile, saveHandbackFile,
  stepEventId, taskBinding, taskBindings, verifyContinuation,
} from "../index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(here, "fixtures", "consumer-process.mjs");
const SECRET = "test-only-secret-0123456789abcdef-xyz";
const keyring = createKeyring([{ kid: "t1", secret: SECRET }]);
const TOOL = "example.compare";
const ORIGIN = "https://shop.example";
const OTHER_ORIGIN = "https://other.example";
const RAW_INPUT = { before: { url: "https://shop.example/p/raw-input-marker", price: 10 }, after: { url: "https://shop.example/p/raw-input-marker", price: 12 } };
const SUBJECT = hashJson(RAW_INPUT.before.url);
const TERMS = `sha256:${"a".repeat(64)}`;
const SOURCES = ["mcp", "cli", "llms", "skill", "a2a", "registry", "other"];
const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const code = (fn) => { try { fn(); } catch (error) { return error.code; } return null; };

async function scratch(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "tc-consumer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fresh(task = taskBinding({ tool: TOOL, origin: ORIGIN, subject: SUBJECT, termsVersion: TERMS }), nowMs = NOW) {
  const issued = issueContinuation({ keyring, tool: task.tool, subject: task.subject, bindings: taskBindings(task), nowMs });
  return { task, issued, handback: createHandback({ task, issued }) };
}

// --- measurement fields ------------------------------------------------------

test("module 1.3.0 shares the page-change measurement enums", () => {
  assert.equal(MODULE_VERSION, "1.3.0");
  assert.deepEqual(DISCOVERY_BASIS_KINDS, ["request_referer", "mount_hook", "caller_meta"]);
  assert.deepEqual(ENTRY_SURFACES, ["hosted", "installed"]);
  assert.deepEqual(ENTRY_BASES, ["deployment_marker", "no_deployment_marker", "local_cli"]);
  assert.deepEqual(ENTRY_TRANSPORTS, ["mcp_streamable_http", "cli"]);
});

test("truthful acquisition: observed only from server evidence, declared from the caller, else unknown", () => {
  const observed = acquireDiscovery({ evidence: { source: "llms", basis: { kind: "request_referer", matched: "/llms.txt" } }, declared: "cli", sources: SOURCES });
  assert.deepEqual(observed, { discovery: { status: "observed", source: "llms" }, discoveryBasis: { kind: "request_referer", matched: "/llms.txt" } });
  assert.deepEqual(acquireDiscovery({ evidence: { source: "mcp", basis: { kind: "mount_hook", matched: "ignored" } }, sources: SOURCES }).discoveryBasis, { kind: "mount_hook", matched: null });
  const declared = acquireDiscovery({ declared: "cli", sources: SOURCES });
  assert.deepEqual(declared, { discovery: { status: "declared", source: "cli" }, discoveryBasis: { kind: "caller_meta", matched: null } });
  assert.deepEqual(acquireDiscovery({ sources: SOURCES }), { discovery: { status: "unknown", source: null }, discoveryBasis: null });
  // A caller cannot produce observed: claimed basis kinds, objects and unknown sources fall back.
  for (const evidence of [{ source: "llms", basis: { kind: "caller_meta", matched: null } }, { source: "llms" }, { source: "llms", basis: { kind: "request_referer", matched: "" } }, { source: "evil", basis: { kind: "mount_hook", matched: null } }]) {
    assert.notEqual(acquireDiscovery({ evidence, sources: SOURCES }).discovery.status, "observed");
  }
  assert.equal(acquireDiscovery({ declared: { status: "observed", source: "llms" }, sources: SOURCES }).discovery.status, "unknown");
  // A record that claims observed on caller meta is refused, not repaired.
  const base = { correlationId: "ae:corr:v1:AAAAAAAAAAAAAAAAAAAAAA", step: 0, tool: TOOL };
  assert.equal(code(() => measurementRecord({ ...base, discovery: { status: "observed", source: "llms" }, discoveryBasis: { kind: "caller_meta", matched: null } })), "continuation_measurement_invalid");
  assert.equal(code(() => measurementRecord({ ...base, discovery: { status: "observed", source: "llms" }, discoveryBasis: null })), "continuation_measurement_invalid");
  assert.equal(code(() => measurementRecord({ ...base, discovery: { status: "declared", source: "cli" }, discoveryBasis: { kind: "mount_hook", matched: null } })), "continuation_measurement_invalid");
  const record = measurementRecord({ ...base, ...observed, nowMs: NOW, entrySurface: entrySurfaceFromRuntime({ env: { MARK: "x" }, markerEnv: "MARK" }) });
  assert.equal(record.occurredAt, "2026-11-12T12:00:00.000Z");
  assert.ok(observedIsProven(record));
  assert.equal(observedIsProven(measurementRecord({ ...base, discovery: { status: "observed", source: "llms" } })), false);
  assert.deepEqual(record.entrySurface, { surface: "hosted", basis: "deployment_marker", transport: "mcp_streamable_http" });
  assert.deepEqual(entrySurfaceFromRuntime({ env: {}, markerEnv: "MARK" }), { surface: "installed", basis: "no_deployment_marker", transport: "mcp_streamable_http" });
  assert.deepEqual(entrySurfaceFromRuntime({ transport: "cli" }), { surface: "installed", basis: "local_cli", transport: "cli" });
  assert.ok(!JSON.stringify(record).includes("\"x\""), "marker value never copied");
});

test("measurement records: 1.2.0 shape loads; malformed and late are refused with typed codes", () => {
  const { issued } = fresh();
  const legacy = { v: 1, kind: "measurement", tool: TOOL, correlationId: issued.correlationId, step: 0, discovery: { status: "declared", source: "cli" }, outcome: "changed" };
  assert.deepEqual(checkMeasurementRecord(legacy), legacy);
  assert.deepEqual(measurementRecord({ correlationId: issued.correlationId, discovery: legacy.discovery, step: 0, tool: TOOL, outcome: "changed" }), legacy);
  const full = { ...legacy, occurredAt: "2026-11-12T12:00:00.000Z", discoveryBasis: { kind: "caller_meta", matched: null }, entrySurface: { surface: "installed", basis: "local_cli", transport: "cli" } };
  assert.deepEqual(checkMeasurementRecord(full, { expiresAt: issued.expiresAt, nowMs: NOW }), full);
  const malformed = [
    { ...full, token: issued.token },
    { ...full, kid: "t1" },
    { ...full, occurredAt: "2026-11-12T12:00:00Z" },
    { ...full, occurredAt: "2026-02-30T12:00:00.000Z" },
    { ...full, occurredAt: "yesterday" },
    { ...full, occurredAt: 1762948800000 },
    { ...full, discovery: { status: "observed", source: "cli" } },
    { ...full, discovery: { status: "unknown", source: "cli" }, discoveryBasis: null },
    { ...full, discoveryBasis: { kind: "request_referer", matched: null } },
    { ...full, discoveryBasis: { kind: "caller_meta", matched: "x" } },
    { ...full, discoveryBasis: { kind: "caller_meta", matched: null, raw: "Referer: x" } },
    { ...full, entrySurface: { surface: "hosted", basis: "no_deployment_marker", transport: "mcp_streamable_http" } },
    { ...full, entrySurface: { surface: "installed", basis: "local_cli", transport: "mcp_streamable_http" } },
    { ...full, entrySurface: { surface: "installed", basis: "local_cli", transport: "cli", deploymentId: "d" } },
    { ...full, discovery: { status: "declared", source: "x".repeat(40) } },
    { ...full, kind: "continuation" },
    "not a record",
  ];
  for (const record of malformed) assert.equal(code(() => checkMeasurementRecord(record)), "continuation_measurement_invalid", JSON.stringify(record).slice(0, 120));
  assert.equal(code(() => checkMeasurementRecord({ ...full, occurredAt: "2026-11-12T13:00:00.000Z" }, { nowMs: NOW })), "continuation_measurement_invalid", "future beyond skew");
  assert.equal(code(() => checkMeasurementRecord({ ...full, occurredAt: issued.expiresAt }, { expiresAt: issued.expiresAt })), "continuation_measurement_late");
  assert.equal(code(() => checkMeasurementRecord({ ...full, occurredAt: "2027-01-01T00:00:00.000Z" }, { expiresAt: issued.expiresAt })), "continuation_measurement_late");
  assert.equal(code(() => measurementRecord({ correlationId: issued.correlationId, step: 0, tool: TOOL, occurredAt: "2027-01-01T00:00:00.000Z", expiresAt: issued.expiresAt })), "continuation_measurement_late");
  assert.equal(ERROR_CODES.continuation_measurement_late.exitCategory, "expired");
  assert.equal(ERROR_CODES.continuation_measurement_invalid.exitCategory, "integrity");
});

test("measurement records match measurement.schema.json", async () => {
  const schema = JSON.parse(await readFile(new URL("../measurement.schema.json", import.meta.url), "utf8"));
  const { issued } = fresh();
  const samples = [
    measurementRecord({ correlationId: issued.correlationId, step: 0, tool: TOOL }),
    measurementRecord({ correlationId: issued.correlationId, step: 1, tool: TOOL, ...acquireDiscovery({ evidence: { source: "llms", basis: { kind: "request_referer", matched: "/llms.txt" } }, sources: SOURCES }), nowMs: NOW, entrySurface: null, outcome: "changed" }),
  ];
  for (const sample of samples) assert.deepEqual(check(schema, sample), []);
  assert.notDeepEqual(check(schema, { ...samples[1], token: issued.token }), []);
});

// --- task binding, refusals --------------------------------------------------

test("origin separation: same tool and subject on another origin never verifies or resumes", () => {
  const { task, issued, handback } = fresh();
  const other = taskBinding({ tool: TOOL, origin: OTHER_ORIGIN, subject: SUBJECT, termsVersion: TERMS });
  assert.notEqual(task.origin, other.origin);
  assert.equal(taskBinding({ tool: TOOL, origin: "HTTPS://Shop.Example:443/any/path?q=1", subject: SUBJECT, termsVersion: TERMS }).origin, task.origin);
  assert.equal(code(() => verifyContinuation(issued.token, { keyring, tool: TOOL, subject: SUBJECT, bindings: taskBindings(other), correlationId: issued.correlationId, nowMs: NOW })), "continuation_binding_mismatch");
  assert.ok(verifyContinuation(issued.token, { keyring, tool: TOOL, subject: SUBJECT, bindings: taskBindings(task), correlationId: issued.correlationId, nowMs: NOW }));
  assert.equal(code(() => assertResumable(handback, other, { nowMs: NOW })), "continuation_task_changed");
  assert.equal(code(() => taskBinding({ tool: TOOL, origin: "ftp://shop.example", subject: SUBJECT })), "continuation_invalid");
  assert.equal(code(() => taskBinding({ tool: TOOL, origin: "https://user:pw@shop.example", subject: SUBJECT })), "continuation_invalid");
});

test("changed task: tool, origin, terms or subject gives continuation_task_changed pointing to a new chain", () => {
  const { handback } = fresh();
  const variants = {
    tool: taskBinding({ tool: "example.other", origin: ORIGIN, subject: SUBJECT, termsVersion: TERMS }),
    origin: taskBinding({ tool: TOOL, origin: OTHER_ORIGIN, subject: SUBJECT, termsVersion: TERMS }),
    terms: taskBinding({ tool: TOOL, origin: ORIGIN, subject: SUBJECT, termsVersion: `sha256:${"b".repeat(64)}` }),
    subject: taskBinding({ tool: TOOL, origin: ORIGIN, subject: hashJson("another page"), termsVersion: TERMS }),
  };
  for (const [field, task] of Object.entries(variants)) {
    let error;
    try { assertSameTask(handback, task); } catch (caught) { error = caught; }
    assert.equal(error.code, "continuation_task_changed", field);
    assert.deepEqual(error.changed, [field]);
  }
  const body = refusal("continuation_task_changed");
  assert.equal(body.nextMethod, "start_new_chain");
  assert.equal(ERROR_CODES.continuation_task_changed.exitCode, 5);
  // Never rebinds: the held handback still names the original task.
  assert.deepEqual(checkHandback(handback).task, fresh().task);
});

test("expired, revoked and wrong-scope refusals are typed", () => {
  const { task, issued, handback } = fresh();
  const verify = (extra) => code(() => verifyContinuation(issued.token, { keyring, tool: TOOL, subject: SUBJECT, bindings: taskBindings(task), correlationId: issued.correlationId, nowMs: NOW, ...extra }));
  assert.equal(verify({ nowMs: Date.parse(issued.expiresAt) }), "continuation_expired");
  assert.equal(code(() => assertResumable(handback, task, { nowMs: Date.parse(issued.expiresAt) })), "continuation_expired");
  assert.equal(code(() => beginDispatch(handback, { nowMs: Date.parse(issued.expiresAt) + 1 })), "continuation_expired");
  assert.equal(verify({ revoked: { kids: ["t1"] } }), "continuation_revoked");
  assert.equal(verify({ revoked: { correlationIds: [issued.correlationId] } }), "continuation_revoked");
  assert.equal(verify({ revoked: { correlationIds: ["ae:corr:v1:BBBBBBBBBBBBBBBBBBBBBB"] } }), null);
  assert.equal(verify({ tool: "example.other" }), "continuation_wrong_tool");
  assert.equal(verify({ subject: hashJson("x") }), "continuation_subject_mismatch");
  assert.equal(verify({ bindings: { origin: task.origin } }), "continuation_binding_mismatch");
  assert.equal(refusal("continuation_revoked").nextMethod, "start_new_chain");
  assert.equal(ERROR_CODES.continuation_revoked.exitCategory, "auth");
  // 1.2.0 refusals keep their null cues.
  assert.equal(refusal("continuation_expired").nextMethod, null);
  for (const name of ["continuation_revoked", "continuation_task_changed", "continuation_dispatch_pending", "continuation_result_unknown", "continuation_state_invalid", "continuation_handback_invalid"]) {
    assert.ok(ERROR_MESSAGES[name] && ERROR_CODES[name], name);
  }
});

// --- handback -----------------------------------------------------------------

test("handback export holds no token, key, kid or raw input and validates against handback.schema.json", async (t) => {
  const schema = JSON.parse(await readFile(new URL("../handback.schema.json", import.meta.url), "utf8"));
  const { issued, handback } = fresh();
  const pending = beginDispatch(handback, { nowMs: NOW });
  const done = recordResult(pending, { digest: hashJson({ price: 12 }) });
  for (const value of [handback, pending, markResultUnknown(pending), done, advanceHandback(done, "acceptance"), advanceHandback(advanceHandback(done, "acceptance"), "settlement"), advanceHandback(handback, "quote")]) {
    const text = exportHandback(value);
    const [, payload, signature] = issued.token.split(".");
    for (const secret of [issued.token, payload, signature, SECRET, "t1", "tc1.", ORIGIN, "shop.example", "raw-input-marker", JSON.stringify(RAW_INPUT.before)]) {
      assert.ok(!text.includes(secret), `export leaks ${secret.slice(0, 12)}`);
    }
    assert.deepEqual(check(schema, JSON.parse(text)), [], value.state);
    assert.deepEqual(importHandback(text), checkHandback(value));
  }
  assert.deepEqual(HANDBACK_STATES, schema.properties.state.enum);
  // A token cannot ride inside: closed shape and patterned strings.
  const parsed = JSON.parse(exportHandback(handback));
  for (const bad of [{ ...parsed, token: issued.token }, { ...parsed, task: { ...parsed.task, origin: issued.token } }, { ...parsed, kid: "t1" }, { ...parsed, schema: "other" }, { ...parsed, state: "paid" }, { ...parsed, pending: { stepEventId: stepEventId(parsed.correlationId, 0), step: 0, savedAt: "2026-11-12T12:00:00.000Z" } }]) {
    assert.equal(code(() => importHandback(JSON.stringify(bad))), "continuation_handback_invalid");
  }
  assert.equal(code(() => importHandback(JSON.stringify({ ...parsed, hashAlg: undefined }))), "continuation_handback_invalid");
  assert.equal(code(() => importHandback(JSON.stringify({ ...parsed, hashAlg: "legacy" }))), "continuation_hash_legacy");
  assert.equal(code(() => importHandback("x".repeat(20_000))), "continuation_handback_invalid");
  assert.equal(parsed.schema, HANDBACK_SCHEMA);
  // File round trip through the owner-only store kernel.
  const dir = await scratch(t);
  await saveHandbackFile(path.join(dir, "h.json"), done);
  assert.deepEqual(await loadHandbackFile(path.join(dir, "h.json")), checkHandback(done));
});

test("states stay distinct: no skipping from preview to settlement, no acceptance without a result", () => {
  const { handback } = fresh();
  assert.equal(code(() => advanceHandback(handback, "settlement")), "continuation_state_invalid");
  assert.equal(code(() => advanceHandback(handback, "acceptance")), "continuation_state_invalid");
  assert.equal(code(() => recordResult(handback, { digest: hashJson(1) })), "continuation_state_invalid");
  const quoted = advanceHandback(handback, "quote");
  const pending = beginDispatch(quoted, { nowMs: NOW });
  assert.equal(pending.state, "execution");
  assert.equal(code(() => advanceHandback(pending, "acceptance")), "continuation_state_invalid");
  assert.equal(code(() => nextHandbackStep(pending, {})), "continuation_state_invalid");
});

test("unknown result: readback is read-only evidence and never re-opens dispatch", () => {
  const { handback } = fresh();
  const pending = beginDispatch(handback, { nowMs: NOW });
  const unknown = markResultUnknown(pending);
  assert.equal(code(() => beginDispatch(pending, { nowMs: NOW })), "continuation_dispatch_pending");
  assert.equal(code(() => beginDispatch(unknown, { nowMs: NOW })), "continuation_dispatch_pending");
  for (const readback of [null, { found: false }, { found: true, stepEventId: stepEventId(unknown.correlationId, 9), digest: hashJson(1) }, { found: true, stepEventId: unknown.pending.stepEventId }]) {
    const applied = applyReadback(unknown, readback);
    assert.equal(applied.handback.state, "result_unknown");
    assert.equal(applied.refusal.code, "continuation_result_unknown");
    assert.equal(applied.refusal.nextMethod, "readback");
    assert.equal(applied.refusal.stepEventId, unknown.pending.stepEventId);
    assert.equal(code(() => beginDispatch(applied.handback, { nowMs: NOW })), "continuation_dispatch_pending");
  }
  const found = applyReadback(unknown, { found: true, stepEventId: unknown.pending.stepEventId, digest: hashJson({ price: 12 }) });
  assert.equal(found.refusal, null);
  assert.equal(found.handback.state, "result");
  assert.equal(code(() => beginDispatch(found.handback, { nowMs: NOW })), "continuation_state_invalid");
  assert.equal(ERROR_CODES.continuation_result_unknown.retryable, true);
});

// --- fresh processes against a local fixture issuer --------------------------

function fixtureIssuer() {
  const effects = new Map();
  let effectCalls = 0;
  let loseNext = false;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    const send = (value) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.method === "GET" && req.url.startsWith("/readback/")) {
      const id = req.url.slice("/readback/".length);
      return send(effects.has(id) ? { found: true, stepEventId: id, digest: effects.get(id) } : { found: false });
    }
    try {
      if (req.url === "/effect") {
        const held = verifyContinuation(body.token, { keyring, tool: TOOL, subject: SUBJECT, bindings: { origin: taskBinding({ tool: TOOL, origin: ORIGIN, subject: SUBJECT }).origin, termsVersion: TERMS }, correlationId: body.correlationId });
        if (body.stepEventId !== stepEventId(held.correlationId, held.step)) return send(refusal("continuation_invalid"));
        effectCalls += 1;
        // Idempotent by stepEventId: a repeat returns the stored result.
        if (!effects.has(body.stepEventId)) effects.set(body.stepEventId, hashJson({ applied: body.stepEventId }));
        if (loseNext) { loseNext = false; req.socket.destroy(); return undefined; }
        return send({ ok: true, digest: effects.get(body.stepEventId) });
      }
      if (req.url === "/continue") {
        const held = verifyContinuation(body.token, { keyring, tool: body.task.tool, subject: body.task.subject, bindings: taskBindings(body.task), correlationId: body.correlationId });
        return send({ ok: true, continuation: issueContinuation({ keyring, tool: held.tool, subject: held.sub, bindings: taskBindings(body.task), previous: held }) });
      }
    } catch (error) {
      return send(refusal(error.code));
    }
    res.statusCode = 404;
    return res.end();
  });
  return {
    server,
    get effectCalls() { return effectCalls; },
    get effectsApplied() { return effects.size; },
    loseNextResponse() { loseNext = true; },
  };
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DRIVER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr, json: stdout.trim() ? JSON.parse(stdout.trim().split("\n").at(-1)) : null }));
  });
}

async function startChain(t) {
  const issuer = fixtureIssuer();
  await new Promise((resolve) => issuer.server.listen(0, "127.0.0.1", resolve));
  t.after(() => issuer.server.close());
  const url = `http://127.0.0.1:${issuer.server.address().port}`;
  const dir = await scratch(t);
  const task = taskBinding({ tool: TOOL, origin: ORIGIN, subject: SUBJECT, termsVersion: TERMS });
  const issued = issueContinuation({ keyring, tool: TOOL, subject: SUBJECT, bindings: taskBindings(task) });
  await saveContinuationFile(path.join(dir, "caller.json"), issued);
  await saveHandbackFile(path.join(dir, "handback.json"), createHandback({ task, issued }));
  return { issuer, url, dir, args: (mode, origin = ORIGIN, subject = SUBJECT, terms = TERMS) => [mode, dir, url, origin, subject, terms] };
}

test("fresh processes: dispatch, then a new process resumes from the handback and continues the same chain", async (t) => {
  const { issuer, dir, args } = await startChain(t);
  const first = await run(args("dispatch"));
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.deepEqual(first.json, { state: "result", step: 0 });
  const second = await run(args("continue"));
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.equal(second.json.step, 1);
  assert.equal(second.json.state, "preview");
  const third = await run(args("dispatch"));
  assert.deepEqual(third.json, { state: "result", step: 1 });
  assert.equal(issuer.effectsApplied, 2);
  const text = await readFile(path.join(dir, "handback.json"), "utf8");
  assert.ok(!text.includes("tc1.") && !text.includes(ORIGIN));
});

test("fresh process on a materially changed task is refused before any call and points to a new chain", async (t) => {
  const { issuer, args } = await startChain(t);
  for (const [changed, argv] of [["origin", args("dispatch", OTHER_ORIGIN)], ["subject", args("dispatch", ORIGIN, hashJson("another page"))], ["terms", args("continue", ORIGIN, SUBJECT, `sha256:${"c".repeat(64)}`)]]) {
    const result = await run(argv);
    assert.equal(result.status, 5, changed);
    assert.equal(result.json.code, "continuation_task_changed");
    assert.equal(result.json.nextMethod, "start_new_chain");
    assert.deepEqual(result.json.changed, [changed]);
  }
  assert.equal(issuer.effectCalls, 0);
});

test("lost response: a new process reads back the stored result and never sends a second effect", async (t) => {
  const { issuer, args } = await startChain(t);
  issuer.loseNextResponse();
  const lost = await run(args("dispatch"));
  assert.equal(lost.json.code, "continuation_result_unknown");
  assert.equal(lost.status, ERROR_CODES.continuation_result_unknown.exitCode);
  assert.equal(issuer.effectCalls, 1);
  const again = await run(args("dispatch"));
  assert.equal(again.json.code, "continuation_dispatch_pending");
  const recovered = await run(args("recover"));
  assert.equal(recovered.status, 0, recovered.stdout);
  assert.deepEqual(recovered.json, { redispatch: "continuation_dispatch_pending", state: "result", refusal: null });
  assert.equal(issuer.effectCalls, 1, "no second effect call");
  assert.equal(issuer.effectsApplied, 1);
});

test("crash after saving pending, before sending: readback says unknown and dispatch stays closed", async (t) => {
  const { issuer, args } = await startChain(t);
  const crashed = await run(args("crash-after-save"));
  assert.equal(crashed.status, 70);
  const recovered = await run(args("recover"));
  assert.equal(recovered.json.state, "result_unknown");
  assert.equal(recovered.json.refusal.code, "continuation_result_unknown");
  assert.equal(recovered.json.redispatch, "continuation_dispatch_pending");
  const again = await run(args("dispatch"));
  assert.equal(again.json.code, "continuation_dispatch_pending");
  assert.equal(issuer.effectCalls, 0);
});

// Minimal JSON Schema checker for the keywords these schemas use.
function check(schema, value, at = "$") {
  const known = new Set(["$schema", "$id", "title", "description", "type", "required", "properties", "additionalProperties", "const", "enum", "pattern", "minimum", "minLength", "maxLength", "anyOf"]);
  for (const key of Object.keys(schema)) if (!known.has(key)) throw new Error(`checker does not support ${key}`);
  const errors = [];
  if (schema.anyOf) {
    if (!schema.anyOf.some((sub) => check(sub, value, at).length === 0)) errors.push(`${at}: anyOf`);
    return errors;
  }
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (schema.type && !(schema.type === typeOf(value) || (schema.type === "number" && typeof value === "number"))) return [`${at}: type`];
  if (Object.hasOwn(schema, "const") && value !== schema.const) errors.push(`${at}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: enum`);
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: pattern`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: maxLength`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: minimum`);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) errors.push(...check(schema.properties[key], child, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${key}: additional`);
    }
  }
  return errors;
}
