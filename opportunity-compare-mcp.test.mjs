import assert from "node:assert/strict";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import express from "express";
import {
  OPPORTUNITY_COMPARE_HOSTED_PROFILE,
  OPPORTUNITY_COMPARE_MCP_ENV,
  OPPORTUNITY_COMPARE_MCP_FLAG_ON,
  OPPORTUNITY_COMPARE_MCP_PATH,
  OPPORTUNITY_COMPARE_MCP_TOOL,
  compareOpportunityRecords,
  isOpportunityCompareMcpEnabled,
  isOpportunityCompareMcpPath,
  maybeMountOpportunityCompareMcp,
  mountOpportunityCompareMcp,
  opportunityCompareHostedAdmission,
  opportunityCompareHostedLimits,
  opportunityCompareRpcEnvelope,
} from "./opportunity-compare-mcp.mjs";
import { pageChangeHttpLimits } from "./page-change-http.mjs";
import { MAX_COMPARE_RECORDS, PRODUCT, SCHEMA_VERSION, TOOL_ELIGIBILITY } from "./vendor/opportunity-eligibility/eligibility-tool/tools.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const fx = (...parts) => path.join(cwd, "fixtures/opportunity-compare", ...parts);
const load = (...parts) => JSON.parse(readFileSync(fx(...parts), "utf8"));
const ACCEPT = "application/json, text/event-stream";
const NOW = "2026-11-12T11:05:00.000Z";
const EXPIRED_NOW = "2026-11-12T12:00:00.000Z";

const eligible = load("positive-eligible.json");
const notEligible = load("positive-not-eligible.json");
const unknownRecord = load("unknown.json");
const expiredRecord = load("expired.json");
const refusedRecord = load("refused-missing-keys.json");
const malformedEnvelope = load("malformed-envelope.json");
const positiveArguments = load("positive-arguments.json");

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

// Separates an SDK or wire failure from a domain JSON result. Only text that
// parses to this product's envelope is a domain body. SDK input validation
// answers isError with "MCP error -32602: ..." text, which is a protocol
// refusal and is never parsed as a domain result.
function toolOutcome(message) {
  if (message && typeof message === "object" && Object.hasOwn(message, "error")) {
    return { kind: "rpc_error", code: message.error?.code, message: message.error?.message };
  }
  const result = message && typeof message === "object" && Object.hasOwn(message, "result") ? message.result : message;
  const isError = result?.isError === true;
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") return { kind: "wire", isError, text: null };
  const protocol = /^MCP error (-?\d+):/.exec(text);
  if (protocol) return { kind: "protocol", isError, code: Number(protocol[1]), text };
  let body;
  try { body = JSON.parse(text); } catch { return { kind: "wire", isError, text }; }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.product !== PRODUCT || body.schemaVersion !== SCHEMA_VERSION) {
    return { kind: "wire", isError, text };
  }
  return { kind: "domain", isError, body, structuredContent: result.structuredContent };
}

// An HTTP reply that is not 200 is a transport admission refusal (413
// payload_too_large, 400 json_node_limit, ...), even when its body is
// product-shaped JSON. It is never a domain result or a semantic disagreement.
// No reply at all (a connection reset or other socket error) is a transport
// failure with an unknown outcome: not a 413 and not an admission refusal,
// because no server receipt establishes a rejection.
function hostedOutcome(reply) {
  const status = reply?.response?.status ?? reply?.status ?? null;
  if (status === null) return { kind: "transport_failure", outcome: "unknown", error: reply?.error ?? null };
  if (status !== 200) return { kind: "transport", status, code: reply?.json?.code ?? null };
  return toolOutcome(reply.json);
}

function installedOutcome(result) {
  if (result && typeof result === "object" && Object.hasOwn(result, "transport")) {
    return { kind: "transport", status: result.transport.status, code: result.transport.code };
  }
  return toolOutcome({ jsonrpc: "2.0", id: 1, result });
}

// Domain parity is qualified only over inputs both halves admit.
function parityOver(installed, hosted) {
  const a = installedOutcome(installed);
  const b = hostedOutcome(hosted);
  if ([a.kind, b.kind].some((kind) => kind === "transport" || kind === "transport_failure")) return { compared: false, installed: a, hosted: b };
  return { compared: true, installed: a, hosted: b, equal: a.kind === b.kind && isDeepStrictEqual(a.body, b.body) };
}

function domainOkForReset() {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, product: PRODUCT, schemaVersion: SCHEMA_VERSION, charged: false }) }] };
}

function jsonNodes(value) {
  if (!value || typeof value !== "object") return 1;
  return 1 + (Array.isArray(value) ? value : Object.values(value)).reduce((n, child) => n + jsonNodes(child), 0);
}

function toolBody(message) {
  const outcome = toolOutcome(message);
  assert.equal(outcome.kind, "domain", `expected a domain JSON result, got ${outcome.kind}: ${outcome.text ?? outcome.message ?? ""}`);
  return outcome.body;
}

function assertProtocolRefusal(message, code = -32602) {
  const outcome = toolOutcome(message);
  assert.equal(outcome.kind, "protocol", `expected an SDK protocol refusal, got ${outcome.kind}`);
  assert.equal(outcome.isError, true);
  assert.equal(outcome.code, code);
  assert.match(outcome.text, /Input validation error/);
  assert.match(outcome.text, new RegExp(OPPORTUNITY_COMPARE_MCP_TOOL));
  assert.equal(message.result.structuredContent, undefined);
  return outcome;
}

async function listenRoute(env = { [OPPORTUNITY_COMPARE_MCP_ENV]: OPPORTUNITY_COMPARE_MCP_FLAG_ON }, afterMount = null) {
  const app = express();
  const mount = maybeMountOpportunityCompareMcp(app, { env });
  if (typeof afterMount === "function") afterMount(app);
  const server = createHttpServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    mount,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function postRpc(base, body, { rpcPath = OPPORTUNITY_COMPARE_MCP_PATH, headers = {}, method = "POST" } = {}) {
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

function callCompareRpc(arguments_) {
  return opportunityCompareRpcEnvelope(arguments_, 1);
}

// Raw POST that keeps a response the server sends before it closes an
// oversized upload; an error before any response is reported, not thrown.
function postRaw(base, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = httpRequest(`${base}${OPPORTUNITY_COMPARE_MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: ACCEPT, "content-length": Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", () => {});
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        done({ status: res.statusCode, text, json });
      });
    });
    req.on("error", (error) => done({ status: null, error: error.code || String(error) }));
    req.end(payload);
  });
}

// Pads one record's pass-through taskRef so the compact envelope is exactly
// targetBytes. One string node, so only the byte size moves.
function argsAtBytes(targetBytes) {
  const build = (pad) => ({ records: [{ ...eligible, taskRef: "p".repeat(pad) }], now: NOW });
  const baseBytes = Buffer.byteLength(JSON.stringify(callCompareRpc(build(0))));
  const args = build(targetBytes - baseBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(callCompareRpc(args))), targetBytes);
  return args;
}

function compactRecord(i) {
  return {
    consumer: "c",
    jobId: `j${i}`,
    decidedAt: eligible.decidedAt,
    provenance: { source: "s", url: "u", httpStatus: 200, observedAt: eligible.provenance.observedAt, bodySha256: "a" },
    decision: "eligible",
    reasons: ["r"],
    freshness: { evidenceAgeSeconds: 60, maxAgeSeconds: 3600, expiresAt: eligible.freshness.expiresAt },
  };
}

function assertNoPaymentChallenge(response, json, text) {
  assert.notEqual(response.status, 402);
  const www = response.headers.get("www-authenticate");
  assert.equal(www == null || !/x402|payment/i.test(www), true);
  assert.equal(response.headers.get("payment-required") == null, true);
  const haystack = `${text || ""}${json ? JSON.stringify(json) : ""}`;
  assert.equal(/["']x402Version["']/.test(haystack) || /["']PAYMENT-REQUIRED["']/.test(haystack), false);
}

test("path and flag helpers: only the exact value on enables the route", () => {
  assert.equal(isOpportunityCompareMcpPath(OPPORTUNITY_COMPARE_MCP_PATH), true);
  assert.equal(isOpportunityCompareMcpPath("/mcp/opportunity-compare/"), true);
  assert.equal(isOpportunityCompareMcpPath("/mcp/page-change"), false);
  assert.equal(isOpportunityCompareMcpEnabled({ [OPPORTUNITY_COMPARE_MCP_ENV]: "on" }), true);
  assert.equal(isOpportunityCompareMcpEnabled({}), false);
  assert.equal(isOpportunityCompareMcpEnabled({ [OPPORTUNITY_COMPARE_MCP_ENV]: "off" }), false);
  assert.equal(isOpportunityCompareMcpEnabled({ [OPPORTUNITY_COMPARE_MCP_ENV]: "1" }), false);
  assert.equal(isOpportunityCompareMcpEnabled({ [OPPORTUNITY_COMPARE_MCP_ENV]: "true" }), false);
  assert.equal(isOpportunityCompareMcpEnabled({ [OPPORTUNITY_COMPARE_MCP_ENV]: "ON" }), false);
});

test("flag on mounts the route; flag off is not mounted and returns 404", async () => {
  const on = await listenRoute({ [OPPORTUNITY_COMPARE_MCP_ENV]: "on" });
  const off = await listenRoute({});
  const offExplicit = await listenRoute({ [OPPORTUNITY_COMPARE_MCP_ENV]: "off" });
  try {
    assert.equal(on.mount.mounted, true);
    assert.equal(off.mount.mounted, false);
    assert.equal(offExplicit.mount.mounted, false);
    const ok = await postRpc(on.base, callCompareRpc(positiveArguments));
    assert.equal(ok.response.status, 200);
    const missing = await postRpc(off.base, callCompareRpc(positiveArguments));
    assert.equal(missing.response.status, 404);
    const missingExplicit = await postRpc(offExplicit.base, callCompareRpc(positiveArguments));
    assert.equal(missingExplicit.response.status, 404);
  } finally {
    await on.close();
    await off.close();
    await offExplicit.close();
  }
});

test("positive compare on caller-held records (installed and hosted)", async () => {
  const installed = await compareOpportunityRecords(positiveArguments);
  assert.equal(installed.isError, undefined);
  assert.equal(installed.structuredContent.ok, true);
  assert.equal(installed.structuredContent.charged, false);
  assert.equal(installed.structuredContent.product, PRODUCT);
  assert.equal(installed.structuredContent.schemaVersion, SCHEMA_VERSION);
  const result = installed.structuredContent.result;
  assert.equal(result.eligible.length, 1);
  assert.equal(result.notEligible.length, 1);
  assert.equal(result.unknown.length, 0);
  assert.equal(result.refused.length, 0);
  assert.equal(result.eligible[0].jobId, eligible.jobId);
  assert.equal(result.notEligible[0].jobId, notEligible.jobId);

  const profile = await listenRoute();
  try {
    const hosted = await postRpc(profile.base, callCompareRpc(positiveArguments));
    assert.equal(hosted.response.status, 200);
    const body = toolBody(hosted.json);
    assert.equal(body.ok, true);
    assert.equal(body.charged, false);
    assert.equal(body.result.eligible.length, 1);
    assert.equal(body.result.notEligible.length, 1);
    assert.deepEqual(body.result.eligible[0].jobId, result.eligible[0].jobId);
    assert.deepEqual(body.result.notEligible[0].jobId, result.notEligible[0].jobId);
  } finally {
    await profile.close();
  }
});

test("typed refusal: malformed envelope is invalid_input on both halves", async () => {
  for (const args of [malformedEnvelope, {}, { records: "nope" }, { records: [1] }, { records: [eligible], extra: true }]) {
    const installed = await compareOpportunityRecords(args);
    assert.equal(installed.isError, true);
    const body = JSON.parse(installed.content[0].text);
    assert.equal(body.ok, false);
    assert.equal(body.charged, false);
    assert.equal(body.code, "invalid_input");
    assert.equal(body.error, "invalid_input");
  }
  // Hosted: SDK input validation refuses schema-invalid arguments with an
  // isError -32602 protocol result before the handler runs. Arguments that
  // pass the SDK schema but fail the domain contract (an extra top-level key,
  // which the SDK strips) still reach the handler and get the typed body.
  const profile = await listenRoute();
  try {
    for (const args of [malformedEnvelope, {}, { records: "nope" }, { records: [1] }]) {
      const hosted = await postRpc(profile.base, callCompareRpc(args));
      assert.equal(hosted.response.status, 200);
      assertProtocolRefusal(hosted.json);
      assertNoPaymentChallenge(hosted.response, hosted.json, hosted.text);
    }
    const extra = await postRpc(profile.base, callCompareRpc({ records: [eligible], extra: true }));
    assert.equal(extra.response.status, 200);
    const outcome = toolOutcome(extra.json);
    assert.equal(outcome.kind, "domain");
    assert.equal(outcome.isError, true);
    assert.equal(outcome.body.ok, false);
    assert.equal(outcome.body.charged, false);
    assert.equal(outcome.body.code, "invalid_input");
    assert.equal(outcome.body.error, "invalid_input");
  } finally {
    await profile.close();
  }
});

test("tool outcome: SDK protocol text and non-JSON text are never a domain result", () => {
  const protocol = toolOutcome({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "MCP error -32602: Input validation error: Invalid arguments for tool opportunity_compare: x" }], isError: true },
  });
  assert.equal(protocol.kind, "protocol");
  assert.equal(protocol.code, -32602);
  assert.equal(toolOutcome({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "response exceeds server ceiling" }], isError: true } }).kind, "wire");
  assert.equal(toolOutcome({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{\"ok\":true}" }] } }).kind, "wire");
  assert.equal(toolOutcome({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool" } }).kind, "rpc_error");
  assert.equal(toolOutcome(null).kind, "wire");
  // Transport admission refusals are classified by HTTP status, even when the
  // body is product-shaped JSON, and are excluded from domain parity.
  const typed = { ok: false, product: PRODUCT, schemaVersion: SCHEMA_VERSION, charged: false };
  const tooLarge = hostedOutcome({ status: 413, json: { ...typed, error: "payload_too_large", code: "payload_too_large" } });
  assert.deepEqual(tooLarge, { kind: "transport", status: 413, code: "payload_too_large" });
  assert.equal(hostedOutcome({ status: 400, json: { ...typed, error: "json_node_limit", code: "json_node_limit" } }).kind, "transport");
  const reset = hostedOutcome({ status: null, error: "ECONNRESET" });
  assert.deepEqual(reset, { kind: "transport_failure", outcome: "unknown", error: "ECONNRESET" });
  assert.notEqual(reset.kind, "transport");
  assert.equal(Object.hasOwn(reset, "status"), false);
  const resetParity = parityOver(domainOkForReset(), { status: null, error: "ECONNRESET" });
  assert.equal(resetParity.compared, false);
  assert.equal(resetParity.hosted.kind, "transport_failure");
  const refusedInstalled = { transport: { admitted: false, status: 413, code: "payload_too_large" } };
  assert.deepEqual(installedOutcome(refusedInstalled), { kind: "transport", status: 413, code: "payload_too_large" });
  const domainOk = { content: [{ type: "text", text: JSON.stringify({ ...typed, ok: true }) }] };
  const skipped = parityOver(domainOk, { status: 413, json: null });
  assert.equal(skipped.compared, false);
  assert.equal(Object.hasOwn(skipped, "equal"), false);
  const compared = parityOver(domainOk, { status: 200, json: { jsonrpc: "2.0", id: 1, result: domainOk } });
  assert.equal(compared.compared, true);
  assert.equal(compared.equal, true);
  assert.throws(() => toolBody({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "MCP error -32602: x" }], isError: true } }), assert.AssertionError);
});

test("typed refusal: a refused record is typed in result.refused on both halves", async () => {
  const args = { records: [eligible, refusedRecord], now: NOW };
  const installed = await compareOpportunityRecords(args);
  assert.equal(installed.isError, undefined);
  const refused = installed.structuredContent.result.refused;
  assert.equal(refused.length, 1);
  assert.equal(refused[0].index, 1);
  assert.equal(refused[0].jobId, "x");
  assert.ok(Array.isArray(refused[0].problems) && refused[0].problems.length > 0);
  assert.equal(installed.structuredContent.result.eligible.length, 1);

  const profile = await listenRoute();
  try {
    const hosted = await postRpc(profile.base, callCompareRpc(args));
    const body = toolBody(hosted.json);
    assert.equal(body.ok, true);
    assert.equal(body.result.refused.length, 1);
    assert.deepEqual(body.result.refused[0].problems, refused[0].problems);
  } finally {
    await profile.close();
  }
});

test("typed refusal: an expired record becomes unknown with evidence-expired-at-compare", async () => {
  const args = { records: [expiredRecord], now: EXPIRED_NOW };
  const installed = await compareOpportunityRecords(args);
  assert.equal(installed.structuredContent.result.eligible.length, 0);
  const entry = installed.structuredContent.result.unknown[0];
  assert.equal(entry.decision, "unknown");
  assert.deepEqual(entry.reasons, ["evidence-expired-at-compare"]);
  assert.equal(entry.previousDecision, "eligible");
  assert.equal(entry.jobId, expiredRecord.jobId);

  const profile = await listenRoute();
  try {
    const hosted = await postRpc(profile.base, callCompareRpc(args));
    const body = toolBody(hosted.json);
    assert.equal(body.result.unknown[0].previousDecision, "eligible");
    assert.deepEqual(body.result.unknown[0].reasons, ["evidence-expired-at-compare"]);
  } finally {
    await profile.close();
  }
});

test("typed refusal: an unknown record stays in result.unknown on both halves", async () => {
  const args = { records: [unknownRecord], now: NOW };
  const installed = await compareOpportunityRecords(args);
  assert.equal(installed.structuredContent.result.unknown.length, 1);
  assert.equal(installed.structuredContent.result.eligible.length, 0);
  assert.equal(installed.structuredContent.result.unknown[0].decision, "unknown");
  assert.deepEqual(installed.structuredContent.result.unknown[0].reasons, unknownRecord.reasons);
  assert.equal(installed.structuredContent.result.unknown[0].jobId, unknownRecord.jobId);

  const profile = await listenRoute();
  try {
    const hosted = await postRpc(profile.base, callCompareRpc(args));
    const body = toolBody(hosted.json);
    assert.equal(body.result.unknown.length, 1);
    assert.deepEqual(body.result.unknown[0].reasons, unknownRecord.reasons);
  } finally {
    await profile.close();
  }
});

test("bounded input size: oversized body is payload_too_large; over 500 records is installed invalid_input and hosted -32602", async () => {
  const tooMany = await compareOpportunityRecords({ records: Array.from({ length: 501 }, () => ({ ...eligible, jobId: `id-${Math.random()}` })) });
  assert.equal(tooMany.isError, true);
  assert.equal(JSON.parse(tooMany.content[0].text).code, "invalid_input");

  const profile = await listenRoute({
    [OPPORTUNITY_COMPARE_MCP_ENV]: "on",
    PAGE_CHANGE_HTTP_MAX_REQUEST_BYTES: "512",
  });
  try {
    const oversized = await postRpc(profile.base, "x".repeat(600));
    assert.equal(oversized.response.status, 413);
    const body = oversized.json || JSON.parse(oversized.text);
    assert.equal(body.code, "payload_too_large");
    assert.equal(body.ok, false);
    assert.equal(body.charged, false);
  } finally {
    await profile.close();
  }

  // Hosted record bound: records small enough to pass the shared byte and
  // node admission reach SDK validation, which refuses 501 records (maxItems
  // 500) with a -32602 protocol result.
  const route = await listenRoute();
  try {
    const small = Array.from({ length: 501 }, (_, i) => ({ jobId: `id-${i}` }));
    const hosted = await postRpc(route.base, callCompareRpc({ records: small, now: NOW }));
    assert.equal(hosted.response.status, 200);
    assertProtocolRefusal(hosted.json);
  } finally {
    await route.close();
  }
});

test("hosted limits: tools/list advertises maxRecords and the shared request byte budget", async () => {
  const limits = pageChangeHttpLimits({});
  assert.deepEqual(opportunityCompareHostedLimits({}), {
    maxRecords: MAX_COMPARE_RECORDS,
    maxRequestBytes: limits.maxRequestBytes,
    maxJsonNodes: limits.maxJsonNodes,
    maxJsonDepth: limits.maxJsonDepth,
  });
  assert.equal(MAX_COMPARE_RECORDS, 500);
  for (const env of [
    { [OPPORTUNITY_COMPARE_MCP_ENV]: "on" },
    { [OPPORTUNITY_COMPARE_MCP_ENV]: "on", PAGE_CHANGE_HTTP_MAX_REQUEST_BYTES: "4096" },
  ]) {
    const profile = await listenRoute(env);
    try {
      const listed = await postRpc(profile.base, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      assert.equal(listed.response.status, 200);
      const tool = listed.json.result.tools.find((entry) => entry.name === OPPORTUNITY_COMPARE_MCP_TOOL);
      assert.deepEqual(tool._meta.samedaydesk.limits, { ...opportunityCompareHostedLimits(env) });
      assert.equal(tool._meta.samedaydesk.limits.maxRequestBytes, pageChangeHttpLimits(env).maxRequestBytes);
      assert.equal(tool._meta.samedaydesk.limits.maxRecords, MAX_COMPARE_RECORDS);
      assert.equal(tool._meta.samedaydesk.charged, false);
      assert.equal(tool.inputSchema.properties.records.maxItems, MAX_COMPARE_RECORDS);
    } finally {
      await profile.close();
    }
  }
});

test("byte boundary: envelopes just below and at the budget are admitted; one byte over is a transport 413", async () => {
  const max = opportunityCompareHostedLimits({}).maxRequestBytes;
  const hosted = { profile: OPPORTUNITY_COMPARE_HOSTED_PROFILE, env: {} };
  const profile = await listenRoute();
  try {
    for (const bytes of [max - 1, max]) {
      const args = argsAtBytes(bytes);
      assert.deepEqual(opportunityCompareHostedAdmission(args, { env: {} }), { requestBytes: bytes, maxRequestBytes: max, admitted: true });
      const installed = await compareOpportunityRecords(args, hosted);
      const reply = await postRpc(profile.base, JSON.stringify(callCompareRpc(args)));
      assert.equal(reply.response.status, 200);
      const parity = parityOver(installed, reply);
      assert.equal(parity.compared, true);
      assert.equal(parity.hosted.kind, "domain");
      assert.equal(parity.hosted.body.ok, true);
      assert.equal(parity.hosted.body.result.eligible.length, 1);
      assert.equal(parity.equal, true);
    }

    const over = argsAtBytes(max + 1);
    const admission = opportunityCompareHostedAdmission(over, { env: {} });
    assert.deepEqual(admission, { requestBytes: max + 1, maxRequestBytes: max, admitted: false, status: 413, code: "payload_too_large" });
    const installed = await compareOpportunityRecords(over, hosted);
    assert.deepEqual(installed, { transport: admission });
    const reply = await postRaw(profile.base, JSON.stringify(callCompareRpc(over)));
    assert.equal(reply.status, 413, `expected a 413 response, got ${reply.status ?? reply.error}`);
    assert.equal(reply.json.code, "payload_too_large");
    assert.equal(reply.json.charged, false);
    assert.notEqual(reply.json.code, "invalid_input");
    const parity = parityOver(installed, reply);
    assert.equal(parity.compared, false);
    assert.equal(parity.installed.kind, "transport");
    assert.equal(parity.hosted.kind, "transport");
    assert.equal(parity.hosted.status, 413);

    // Installed direct behavior without the profile is unchanged: no byte limit.
    const direct = await compareOpportunityRecords(over);
    assert.equal(direct.isError, undefined);
    assert.equal(direct.structuredContent.ok, true);
    assert.equal(direct.structuredContent.result.eligible.length, 1);
  } finally {
    await profile.close();
  }
});

test("compact high record count: inputs within the byte and node budgets are admitted with domain parity", async () => {
  const limits = opportunityCompareHostedLimits({});
  const hosted = { profile: OPPORTUNITY_COMPARE_HOSTED_PROFILE, env: {} };
  const minimal = { records: Array.from({ length: MAX_COMPARE_RECORDS }, (_, i) => ({ jobId: `c${i}` })), now: NOW };
  const perCompact = jsonNodes(compactRecord(0));
  const compactCount = Math.floor((limits.maxJsonNodes - 1) / perCompact);
  // The record ceiling a budget allows depends on record shape; it is not a
  // fixed count. Compact records fit more than fixture-shaped ones do.
  assert.ok(compactCount > Math.floor((limits.maxJsonNodes - 1) / jsonNodes(eligible)));
  const compact = { records: Array.from({ length: compactCount }, (_, i) => compactRecord(i)), now: NOW };

  const profile = await listenRoute();
  try {
    for (const [args, check] of [
      [minimal, (body) => assert.equal(body.result.refused.length, MAX_COMPARE_RECORDS)],
      [compact, (body) => assert.equal(body.result.eligible.length, compactCount)],
    ]) {
      const admission = opportunityCompareHostedAdmission(args, { env: {} });
      assert.equal(admission.admitted, true);
      assert.ok(admission.requestBytes < limits.maxRequestBytes);
      assert.ok(jsonNodes(args.records) <= limits.maxJsonNodes);
      const installed = await compareOpportunityRecords(args, hosted);
      const reply = await postRpc(profile.base, callCompareRpc(args));
      assert.equal(reply.response.status, 200);
      const parity = parityOver(installed, reply);
      assert.equal(parity.compared, true);
      assert.equal(parity.hosted.kind, "domain");
      assert.equal(parity.hosted.body.ok, true);
      check(parity.hosted.body);
      assert.equal(parity.equal, true);
    }

    // One more compact record crosses the shared node bound, not the byte
    // budget: a transport 400 on both halves, excluded from parity.
    const overNodes = { records: Array.from({ length: compactCount + 1 }, (_, i) => compactRecord(i)), now: NOW };
    const admission = opportunityCompareHostedAdmission(overNodes, { env: {} });
    assert.ok(admission.requestBytes < limits.maxRequestBytes);
    assert.equal(admission.admitted, false);
    assert.equal(admission.status, 400);
    assert.equal(admission.code, "json_node_limit");
    const installed = await compareOpportunityRecords(overNodes, hosted);
    const reply = await postRpc(profile.base, callCompareRpc(overNodes));
    assert.equal(reply.response.status, 400);
    assert.equal(reply.json.code, "json_node_limit");
    assert.equal(parityOver(installed, reply).compared, false);
  } finally {
    await profile.close();
  }
});

test("output ceiling: an oversized success is a typed output_too_large body, not SDK text", async () => {
  const profile = await listenRoute({
    [OPPORTUNITY_COMPARE_MCP_ENV]: "on",
    PAGE_CHANGE_HTTP_MAX_OUTPUT_BYTES: "64",
  });
  try {
    const hosted = await postRpc(profile.base, callCompareRpc(positiveArguments));
    assert.equal(hosted.response.status, 200);
    const outcome = toolOutcome(hosted.json);
    assert.equal(outcome.kind, "domain");
    assert.equal(outcome.isError, true);
    assert.equal(outcome.body.ok, false);
    assert.equal(outcome.body.charged, false);
    assert.equal(outcome.body.code, "output_too_large");
    assert.equal(outcome.body.error, "output_too_large");
    assert.equal(outcome.structuredContent, undefined);
  } finally {
    await profile.close();
  }
});

test("no fetch: stubbed global fetch throws and the compare still succeeds", async () => {
  const previous = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return previous(input, init);
    }
    outbound += 1;
    throw new Error("fetch must not be called");
  };
  try {
    const installed = await compareOpportunityRecords(positiveArguments);
    assert.equal(installed.structuredContent.ok, true);
    assert.equal(outbound, 0);

    const profile = await listenRoute();
    try {
      const hosted = await postRpc(profile.base, callCompareRpc(positiveArguments));
      assert.equal(hosted.response.status, 200);
      assert.equal(toolBody(hosted.json).ok, true);
      assert.equal(outbound, 0);
    } finally {
      await profile.close();
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("free-route compatibility: no payment challenge, and opportunity_eligibility is not mounted", async () => {
  const profile = await listenRoute(
    { [OPPORTUNITY_COMPARE_MCP_ENV]: "on" },
    (app) => {
      app.use((req, res, next) => {
        if (isOpportunityCompareMcpPath(req.path)) return next();
        res.status(402).json({ x402Version: 2, accepts: [{ scheme: "exact" }] });
      });
    },
  );
  try {
    const hosted = await postRpc(profile.base, callCompareRpc(positiveArguments));
    assert.equal(hosted.response.status, 200);
    assertNoPaymentChallenge(hosted.response, hosted.json, hosted.text);
    assert.equal(toolBody(hosted.json).charged, false);
    assert.equal(toolBody(hosted.json).ok, true);

    const eligibility = await postRpc(profile.base, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: TOOL_ELIGIBILITY, arguments: { source: "moltjobs", jobId: eligible.jobId } },
    });
    assert.equal(eligibility.response.status, 200);
    assert.equal(eligibility.json.error.code, -32602);
    assert.deepEqual(eligibility.json.error.data, {
      nextMethod: "tools/list",
      availableTools: [OPPORTUNITY_COMPARE_MCP_TOOL],
    });
    assertNoPaymentChallenge(eligibility.response, eligibility.json, eligibility.text);

    const paid = await fetch(`${profile.base}/extract?url=${encodeURIComponent("https://example.invalid/")}`);
    assert.equal(paid.status, 402);
  } finally {
    await profile.close();
  }
});

test("mounted route answers GET with 405; unmounted still 404", async () => {
  const on = await listenRoute();
  const off = await listenRoute({});
  try {
    const mounted = await postRpc(on.base, null, { method: "GET" });
    assert.equal(mounted.response.status, 405);
    const unmounted = await postRpc(off.base, null, { method: "GET" });
    assert.equal(unmounted.response.status, 404);
  } finally {
    await on.close();
    await off.close();
  }
});

test("direct mountOpportunityCompareMcp still registers only opportunity_compare", () => {
  const names = [];
  const app = {
    post(route, _handler) { names.push(["post", route]); },
    all(route, _handler) { names.push(["all", route]); },
  };
  const result = mountOpportunityCompareMcp(app, { env: { [OPPORTUNITY_COMPARE_MCP_ENV]: "on" } });
  assert.equal(result.tool, OPPORTUNITY_COMPARE_MCP_TOOL);
  assert.deepEqual(names.map((entry) => entry[1]), [OPPORTUNITY_COMPARE_MCP_PATH, OPPORTUNITY_COMPARE_MCP_PATH]);
});
