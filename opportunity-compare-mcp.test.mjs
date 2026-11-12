import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  OPPORTUNITY_COMPARE_MCP_ENV,
  OPPORTUNITY_COMPARE_MCP_FLAG_ON,
  OPPORTUNITY_COMPARE_MCP_PATH,
  OPPORTUNITY_COMPARE_MCP_TOOL,
  compareOpportunityRecords,
  isOpportunityCompareMcpEnabled,
  isOpportunityCompareMcpPath,
  maybeMountOpportunityCompareMcp,
  mountOpportunityCompareMcp,
} from "./opportunity-compare-mcp.mjs";
import { PRODUCT, SCHEMA_VERSION, TOOL_ELIGIBILITY } from "./vendor/opportunity-eligibility/eligibility-tool/tools.mjs";

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
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: OPPORTUNITY_COMPARE_MCP_TOOL, arguments: arguments_ },
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
