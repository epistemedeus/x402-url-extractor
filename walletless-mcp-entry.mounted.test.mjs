import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { request as httpRequest, createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import express from "express";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { publicFetch } from "./extract-batch-c1/public-fetch.mjs";
import { MCP_JSON_RPC_MAX_BYTES } from "./mcp-json-rpc-limit.mjs";
import { mountMcp } from "./mcp-server.mjs";
import {
  createExtractionTrialBudget, executeBoundedTrialRead, mountExtractionTrial, READER_TRIAL_PATH,
  TRIAL_READ_MCP_TOOL, trialReadMcpAnnotations, trialReadMcpDescription, trialReadMcpInputSchema, trialReadMcpOutputSchema,
} from "./extraction-trial.mjs";
import { fixture, authority, NOW, waitFor } from "./extraction-trial-test-fixture.mjs";

const EXCERPT_25 = "eeeeeeeeeeeeeeeeeeeeeeeee";
const TABLE_ENGINE = '<th rowspan="2">Engine</th><th colspan="2">Support</th>';
const TABLE_BLANK = "<td>Alpha</td><td></td><td>Yes";
const NETWORK = "eip155:8453";
const PAY_TO = "0x2000000000000000000000000000000000000002";

function parseMcpText(text) {
  const line = text.split(/\r?\n/).filter((entry) => entry.startsWith("data:")).at(-1);
  return JSON.parse(line ? line.replace(/^data:\s?/, "") : text);
}
function mcpCall(merchant, name, args, { headers = {}, raw } = {}) {
  const body = raw ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return new Promise((resolve, reject) => {
    const url = new URL(merchant.base);
    const req = httpRequest({
      hostname: url.hostname, port: url.port, path: "/mcp", method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        "content-length": Buffer.byteLength(body), ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = text ? parseMcpText(text) : null; } catch { json = null; }
        resolve({ status: response.statusCode, headers: response.headers, text, json, req });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}
function toolJson(message) {
  return JSON.parse(message.result.content[0].text);
}
async function discovery(merchant) {
  return (await merchant.request("/.well-known/extraction-trial")).json;
}
async function trialRows(merchant, events) {
  try {
    return (await events(merchant)).filter((row) => row.extractionTrialOutcome);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("mounted streamable HTTP trial_read returns the frozen table and refuses payment, schema, and source failures", { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const store = await f.store();
  const merchant = await f.start({ store });
  const beforeRows = await trialRows(merchant, f.events);
  const client = new Client({ name: "root18700-walletless-mcp", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${merchant.base}/mcp`)));
  t.after(() => client.close());
  const listed = await client.listTools();
  const trial = listed.tools.find((tool) => tool.name === TRIAL_READ_MCP_TOOL);
  const paid = listed.tools.find((tool) => tool.name === "read");
  assert.ok(trial);
  assert.equal(listed.tools.filter((tool) => tool.name === TRIAL_READ_MCP_TOOL).length, 1);
  assert.deepEqual(trial.annotations, { ...trialReadMcpAnnotations });
  assert.equal(trial.inputSchema.additionalProperties, false);
  assert.deepEqual(trial.inputSchema.required, ["url"]);
  assert.equal(trial.outputSchema.additionalProperties, false);
  assert.equal(trial.outputSchema.properties.charged.const, false);
  assert.equal(trial._meta.samedaydesk.charged, false);
  assert.equal(trial._meta.samedaydesk.paymentRequired, false);
  assert.equal(trial._meta.x402, undefined);
  assert.match(trial.description, /charged is false/);
  assert.match(trial.description, /same original authority/);
  assert.equal(trial.description, trialReadMcpDescription());
  assert.equal(paid._meta.x402.paymentRequired, true);
  assert.equal(String(paid.description).includes("not mcp://"), true);
  assert.equal(listed.tools.some((tool) => tool.name === "recover_paid_result"), true);
  const descriptor = await merchant.request("/mcp");
  const advertised = descriptor.json.freeTools.find((tool) => tool.name === TRIAL_READ_MCP_TOOL);
  assert.equal(advertised.consumesSharedTrialAllowance, true);
  assert.equal(advertised.discovery, descriptor.json.extractionTrial.discovery);
  assert.equal(descriptor.json.toolCount, 23);

  const started = (await discovery(merchant)).started;
  for (const [name, args] of [
    ["extra", { url: f.url("/table"), route: "/trial/read" }],
    ["limit", { url: f.url("/table"), markdownLimitChars: 40001 }],
    ["zero", { url: f.url("/table"), markdownLimitChars: 0 }],
    ["string-limit", { url: f.url("/table"), markdownLimitChars: "25" }],
    ["missing", {}],
  ]) {
    const response = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, args);
    // SDK 1.30 catches InvalidParams inside tools/call and returns an isError
    // tool result. Unknown names are still JSON-RPC -32602 before that handler.
    assert.equal(response.status, 200, name);
    assert.equal(response.json.error, undefined, name);
    assert.equal(response.json.result.isError, true, name);
    assert.equal(response.json.result.structuredContent, undefined, name);
    assert.match(response.json.result.content[0].text, /Input validation error: Invalid arguments for tool trial_read/, name);
  }
  const unknown = await mcpCall(merchant, "trial_read_paid", { url: f.url("/table") });
  assert.equal(unknown.json.error.code, -32602);
  const malformed = await merchant.request("/mcp", { method: "POST", raw: "{" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.error, "invalid_json");
  const oversized = await merchant.request("/mcp", { method: "POST", raw: `{${"x".repeat(MCP_JSON_RPC_MAX_BYTES)}}` });
  assert.equal(oversized.status, 200);
  assert.equal(oversized.json.error.code, -32600);
  assert.equal((await discovery(merchant)).started ?? 0, started ?? 0);
  assert.equal((await trialRows(merchant, f.events)).length, beforeRows.length);
  assert.equal(f.sourceCalls.length, 0);

  const invalid = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: "not a url" });
  assert.equal(invalid.json.result.isError, true);
  assert.equal(invalid.json.result.structuredContent, undefined);
  assert.deepEqual(toolJson(invalid.json), { ok: false, charged: false, error: "invalid_trial_input" });
  assert.equal((await discovery(merchant)).started ?? 0, 0);
  const refusedRow = (await trialRows(merchant, f.events)).at(-1);
  assert.equal(refusedRow.extractionTrialTransport, "mcp");
  assert.equal(refusedRow.extractionTrialOperation, "read");
  assert.equal(refusedRow.extractionTrialOutcome.outcome, "refused");
  assert.equal(refusedRow.status, 200);
  assert.deepEqual(refusedRow.extractionTrialReason, { v: 1, family: "admission", code: "invalid_trial_input" });

  const payment = Buffer.from(JSON.stringify({ x402Version: 2, payload: { kind: "fixture" } }), "utf8").toString("base64");
  const callsBefore = f.calls.length;
  const table = await client.callTool({ name: TRIAL_READ_MCP_TOOL, arguments: { url: f.url("/table") } });
  assert.notEqual(table.isError, true);
  assert.equal(trialReadMcpOutputSchema.safeParse(table.structuredContent).success, true);
  assert.equal(table.structuredContent.charged, false);
  assert.equal(table.structuredContent.sourceOk, true);
  assert.equal(table.structuredContent.truncated, false);
  assert.match(table.structuredContent.markdown, new RegExp(TABLE_ENGINE));
  assert.match(table.structuredContent.markdown, new RegExp(TABLE_BLANK));
  assert.match(table.structuredContent.markdown, new RegExp(`href="${f.url("/table")}#fn1"`));
  assert.match(table.structuredContent.markdown, /<span id="fn1">Preview<\/span>/);
  for (const key of ["payment", "accepts", "x402Version", "transaction", "settlementReference"]) {
    assert.equal(Object.hasOwn(table.structuredContent, key), false, key);
  }
  const paidHeader = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/table") }, { headers: { "payment-signature": payment } });
  assert.notEqual(paidHeader.json.result.isError, true);
  assert.equal(paidHeader.json.result.structuredContent.charged, false);
  assert.equal(paidHeader.json.result.structuredContent.accepts, undefined);
  assert.equal(f.calls.length, callsBefore);
  assert.ok(f.calls.every((call) => call === "GET /supported"));
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");

  const excerpt = await client.callTool({
    name: TRIAL_READ_MCP_TOOL,
    arguments: { url: f.url("/excerpt"), markdownLimitChars: 25 },
  });
  assert.equal(excerpt.structuredContent.markdown, EXCERPT_25);
  assert.equal(excerpt.structuredContent.markdown.length, 25);
  assert.equal(excerpt.structuredContent.truncated, true);
  assert.equal(excerpt.structuredContent.capture.markdownLimitChars, 25);
  assert.equal(excerpt.structuredContent.charged, false);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");

  const omitted = await client.callTool({ name: TRIAL_READ_MCP_TOOL, arguments: { url: f.url("/table-bad") } });
  assert.match(omitted.structuredContent.markdown, /Table omitted:/);
  assert.equal(omitted.structuredContent.truncated, true);
  assert.equal(omitted.structuredContent.charged, false);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");

  const source = await client.callTool({ name: TRIAL_READ_MCP_TOOL, arguments: { url: f.url("/refused") } });
  assert.equal(source.isError, true);
  assert.equal(source.structuredContent, undefined);
  const sourceBody = JSON.parse(source.content[0].text);
  assert.equal(sourceBody.ok, true);
  assert.equal(sourceBody.sourceOk, false);
  assert.equal(sourceBody.error.code, "http_403");
  assert.equal(sourceBody.charged, false);
  assert.equal(sourceBody.accepts, undefined);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");

  const challenged = await mcpCall(merchant, "read", { url: f.url("/table") });
  assert.equal(challenged.json.result.isError, true);
  assert.equal("structuredContent" in challenged.json.result, false);
  const challenge = JSON.parse(challenged.json.result.content[0].text);
  assert.equal(challenge.x402Version, 2);
  assert.ok(Array.isArray(challenge.accepts));
  const recovered = await mcpCall(merchant, "recover_paid_result", { name: TRIAL_READ_MCP_TOOL, arguments: { url: f.url("/table") } });
  assert.equal(recovered.json.result.isError, true);
  assert.equal(toolJson(recovered.json).error, "recovery_tool_rejected");
  assert.ok(f.calls.every((call) => call === "GET /supported"));
  const httpTable = await merchant.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/table") } });
  assert.equal(httpTable.status, 200);
  assert.equal(Object.hasOwn(httpTable.json, "charged"), false);
  assert.match(httpTable.json.markdown, new RegExp(TABLE_BLANK));
  await merchant.stop();
});

test("HTTP and MCP share hops, the lease, restart, and lost-response consumption", { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const store = await f.store(authority({ maxStarted: 20 }));
  const expiresAt = authority().expiresAt;
  let merchant = await f.start({ store });
  const header = { "x-samedaydesk-agent-source": "agent-skills-v1" };
  const first = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/caller-chosen") }, { headers: header });
  assert.equal(first.json.result.structuredContent.sourceOk, true);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");
  const http = await merchant.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/caller-chosen") }, headers: header });
  assert.equal(http.json.sourceOk, true);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");
  assert.equal((await discovery(merchant)).started, 2);
  assert.equal((await discovery(merchant)).expiresAt, expiresAt);

  const unblockMcp = f.block();
  try {
    const hops = f.sourceCalls.length;
    const pending = mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/gate") });
    await waitFor(() => f.sourceCalls.length === hops + 1);
    const busyHttp = await merchant.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/caller-chosen") } });
    assert.equal(busyHttp.status, 503);
    assert.equal(busyHttp.json.availability, "busy");
    assert.equal(busyHttp.json.charged, false);
    const busyMcp = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/caller-chosen") });
    assert.equal(busyMcp.json.result.isError, true);
    assert.equal(toolJson(busyMcp.json).availability, "busy");
    assert.equal(f.sourceCalls.length, hops + 1);
    unblockMcp();
    assert.equal((await pending).json.result.structuredContent.sourceOk, true);
    await waitFor(async () => (await discovery(merchant)).availability !== "busy");
  } finally { unblockMcp(); }

  const unblockHttp = f.block();
  try {
    const hops = f.sourceCalls.length;
    const pending = merchant.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/gate-http") } });
    await waitFor(() => f.sourceCalls.length === hops + 1);
    const busy = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/caller-chosen") });
    assert.equal(toolJson(busy.json).availability, "busy");
    assert.equal(f.sourceCalls.length, hops + 1);
    unblockHttp();
    assert.equal((await pending).json.sourceOk, true);
    await waitFor(async () => (await discovery(merchant)).availability !== "busy");
  } finally { unblockHttp(); }

  const beforeRedirect = f.sourceCalls.length;
  const redirected = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/redirect-ok") });
  assert.equal(redirected.json.result.structuredContent.finalUrl, f.url("/chosen-final"));
  assert.equal(f.sourceCalls.length, beforeRedirect + 2);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");
  const beforeDns = f.sourceCalls.length;
  const dns = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: "http://private-dns.example/dns" });
  assert.equal(dns.json.result.isError, true);
  assert.equal(toolJson(dns.json).error.code, "ssrf_blocked");
  assert.equal(toolJson(dns.json).charged, false);
  assert.equal(f.sourceCalls.length, beforeDns);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");

  const spentBeforeLoss = (await discovery(merchant)).started;
  const unblockLoss = f.block();
  const lossHops = f.sourceCalls.length;
  const lossUrl = new URL(merchant.base);
  const lossBody = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: TRIAL_READ_MCP_TOOL, arguments: { url: f.url("/gate-loss") } } });
  const loss = httpRequest({
    hostname: lossUrl.hostname, port: lossUrl.port, path: "/mcp", method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": Buffer.byteLength(lossBody) },
  });
  loss.on("error", () => {});
  loss.end(lossBody);
  try {
    await waitFor(() => f.sourceCalls.length === lossHops + 1);
    loss.destroy();
    await waitFor(async () => (await trialRows(merchant, f.events)).some((row) => row.extractionTrialTransport === "mcp" && row.extractionTrialOutcome.outcome === "unknown_response"));
  } finally { loss.destroy(); unblockLoss(); }
  await waitFor(async () => (await discovery(merchant)).availability === "enabled");
  assert.equal((await discovery(merchant)).started, spentBeforeLoss + 1);
  const retry = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/caller-chosen") });
  assert.equal(retry.json.result.structuredContent.sourceOk, true);
  await waitFor(async () => (await discovery(merchant)).availability !== "busy");
  assert.equal((await discovery(merchant)).started, spentBeforeLoss + 2, "a lost response does not refund the hop");

  const rows = await trialRows(merchant, f.events);
  assert.ok(rows.some((row) => row.extractionTrialTransport === "mcp" && row.extractionTrialOperation === "read" && row.declaredAgentDiscoverySource === "agent-skills"));
  assert.ok(rows.some((row) => row.extractionTrialTransport === "http" && row.extractionTrialOperation === "read"));
  assert.doesNotMatch(JSON.stringify(rows), /caller\.example|private-dns|Preview|agent-skills-v1|gate-loss/);
  const view = (await merchant.request("/v0/commerce-demand.json")).json.extractionTrial;
  assert.ok(view.transports.populations.unattributed.mcp.admitted >= 1);
  assert.ok(view.transports.populations.unattributed.http.admitted >= 1);
  assert.equal(view.usefulness, "unknown");
  const dataDir = merchant.data;
  const startedAtStop = (await discovery(merchant)).started;
  await merchant.stop();
  merchant = await f.start({ store, dataDir, now: NOW + 60000 });
  const restored = await discovery(merchant);
  assert.equal(restored.started, startedAtStop);
  assert.equal(restored.expiresAt, expiresAt);
  assert.equal(f.calls.every((call) => call === "GET /supported"), true);
  await merchant.stop();
});

test("restarted trial persistence refusals stay on the real predicates for MCP", { timeout: 180000 }, async (t) => {
  const f = await fixture(t);
  const corrupt = await f.store();
  const { chmod, writeFile } = await import("node:fs/promises");
  await chmod(path.join(corrupt, "authority.json"), 0o600);
  await writeFile(path.join(corrupt, "authority.json"), "{");
  const busy = await f.store();
  await mkdir(path.join(busy, ".active"));
  const exhausted = await f.store(authority({ maxStarted: 1 }));
  const exhaustedAuthority = await readFile(path.join(exhausted, "authority.json"));
  const exhaustedSeal = createHash("sha256").update(exhaustedAuthority).digest("hex") + "\n";
  const { open } = await import("node:fs/promises");
  const { constants } = await import("node:fs");
  const spent = await open(path.join(exhausted, "spent-01"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
  await spent.writeFile(exhaustedSeal);
  await spent.close();
  const cases = [
    [await f.store(), "disabled", false],
    [await f.store(authority({ startsAt: new Date(NOW + 1000).toISOString() })), "scheduled", true],
    [await f.store(authority({ startsAt: new Date(NOW - 86400000).toISOString(), expiresAt: new Date(NOW - 1).toISOString() })), "expired", true],
    [exhausted, "exhausted", true],
    [corrupt, "unavailable", true],
    [path.join(f.scratch, "missing"), "unavailable", true],
    [busy, "busy", true],
  ];
  for (const [store, availability, enabled] of cases) {
    const merchant = await f.start({ store, enabled });
    const response = await mcpCall(merchant, TRIAL_READ_MCP_TOOL, { url: f.url("/caller-chosen") });
    assert.equal(response.status, 200, availability);
    assert.equal(response.json.result.isError, true, availability);
    assert.equal(response.json.result.structuredContent, undefined, availability);
    const body = toolJson(response.json);
    assert.equal(body.error, "trial_unavailable", availability);
    assert.equal(body.availability, availability);
    assert.equal(body.charged, false);
    const row = (await trialRows(merchant, f.events)).at(-1);
    assert.equal(row.extractionTrialTransport, "mcp", availability);
    assert.equal(row.extractionTrialOutcome.outcome, "refused", availability);
    assert.equal(row.extractionTrialReason.code, availability, availability);
    assert.equal(row.status, 200, availability);
    if (availability === "exhausted") {
      const http = await merchant.request(READER_TRIAL_PATH, { method: "POST", body: { url: f.url("/caller-chosen") } });
      assert.equal(http.status, 503);
      assert.equal(http.json.availability, "exhausted");
      assert.equal(http.json.charged, false);
      assert.deepEqual(await readFile(path.join(store, "authority.json")), exhaustedAuthority);
    }
    await merchant.stop();
  }
  assert.equal(f.sourceCalls.length, 0);
  assert.ok(f.calls.every((call) => call === "GET /supported"));
});

test("mounted MCP spends the shared seal before DNS and does not verify a presented payment", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const previous = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  t.after(() => { globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = previous; });
  const facilitatorCalls = [];
  const facilitator = {
    async getSupported() { facilitatorCalls.push("supported"); return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] }; },
    async verify() { facilitatorCalls.push("verify"); throw new Error("verify must not run"); },
    async settle() { facilitatorCalls.push("settle"); throw new Error("settle must not run"); },
  };
  for (const mode of ["redirect", "dns-refusal", "persistence-failure", "expiry"]) await t.test(mode, async () => {
    const store = await f.store();
    const raw = await readFile(path.join(store, "authority.json"));
    const seal = createHash("sha256").update(raw).digest("hex") + "\n";
    let clock = NOW, lookups = 0, requests = 0;
    const budget = createExtractionTrialBudget({ enabled: true, dir: store, now: () => clock });
    const shared = {
      status: budget.status.bind(budget),
      async acquire() {
        const lease = await budget.acquire();
        if (mode === "persistence-failure") await mkdir(path.join(store, "spent-01"));
        return lease;
      },
    };
    const notes = [];
    const app = express();
    mountExtractionTrial(app, { budget: shared, observe: (req, res, operation, transport) => {
      notes.push({ operation, transport });
      return () => {};
    } });
    await mountMcp(app, {
      facilitatorClient: facilitator, network: NETWORK, payTo: PAY_TO,
      serverInfo: { name: "trial-read-dns", version: "0" },
      observeExtractionTrial: (req, res, operation, transport) => {
        notes.push({ operation, transport, protocol: "begin" });
        res.on("finish", () => notes.push({ phase: "finish", status: res.statusCode, transport }));
        return (outcome) => notes.push({ outcome, transport });
      },
      tools: [{
        name: TRIAL_READ_MCP_TOOL, free: true, extractionTrialOperation: "read",
        description: trialReadMcpDescription(), price: "$0",
        inputSchema: trialReadMcpInputSchema(), outputSchema: trialReadMcpOutputSchema,
        annotations: trialReadMcpAnnotations,
        run: async (args, note = () => {}) => {
          const outcome = await executeBoundedTrialRead({ budget: shared, note, rawUrl: args?.url, markdownLimitChars: args?.markdownLimitChars });
          return { ...outcome.body, charged: false };
        },
      }, {
        name: "read", description: "paid read", price: "$0.005",
        inputSchema: { url: z.string() },
        run: async () => { throw new Error("paid read must not run for the trial"); },
      }],
    });
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = (url, init) => publicFetch(url, init, {
      async lookup() {
        lookups += 1;
        assert.equal((await budget.status()).started, lookups);
        assert.equal(await readFile(path.join(store, `spent-0${lookups}`), "utf8"), seal);
        assert.equal(notes.some((entry) => entry.protocol === "begin" && entry.transport === "mcp"), true);
        return [{ address: mode === "dns-refusal" ? "127.0.0.1" : "93.184.216.34", family: 4 }];
      },
      request(_url, _options, callback) {
        requests += 1;
        const req = new EventEmitter();
        req.end = () => {
          const body = Readable.from([Buffer.from("<p>fixture</p>")]);
          body.statusCode = requests === 1 ? 302 : 200;
          body.headers = requests === 1 ? { location: "/final" } : {};
          if (mode === "expiry") clock = Date.parse(authority().expiresAt);
          callback(body);
        };
        return req;
      },
    });
    const server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      const payment = Buffer.from(JSON.stringify({ x402Version: 2, payload: { kind: "fixture" } }), "utf8").toString("base64");
      const response = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "payment-signature": payment },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: TRIAL_READ_MCP_TOOL, arguments: { url: "https://ordering.fixture.example/start" } } }),
      });
      const message = parseMcpText(await response.text());
      if (mode === "redirect") {
        assert.equal(message.result.structuredContent.sourceOk, true);
        assert.equal(message.result.structuredContent.charged, false);
        assert.equal(lookups, 2);
        assert.equal(requests, 2);
        const httpResponse = await fetch(`${origin}${READER_TRIAL_PATH}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://ordering.fixture.example/next" }),
        });
        const httpBody = await httpResponse.json();
        assert.equal(httpBody.sourceOk, true);
        assert.equal(Object.hasOwn(httpBody, "charged"), false);
        assert.equal((await budget.status()).started, 3);
        assert.ok(notes.some((entry) => entry.transport === "http"));
      } else if (mode === "dns-refusal") {
        assert.equal(message.result.isError, true);
        assert.equal(toolJson(message).error.code, "ssrf_blocked");
        assert.equal(toolJson(message).charged, false);
        assert.equal(lookups, 1);
        assert.equal(requests, 0);
      } else if (mode === "expiry") {
        assert.equal(message.result.isError, true);
        assert.equal(toolJson(message).error.code, "trial_expired");
        assert.equal(lookups, 1);
        assert.equal(requests, 1);
        assert.equal((await budget.status()).availability, "expired");
      } else {
        assert.equal(message.result.isError, true);
        assert.equal(toolJson(message).availability, "unavailable");
        assert.equal(lookups, 0);
        assert.equal(requests, 0);
        assert.ok((await readdir(store)).includes(".active"));
      }
      assert.equal(facilitatorCalls.includes("verify"), false);
      assert.equal(facilitatorCalls.includes("settle"), false);
      assert.deepEqual(await readFile(path.join(store, "authority.json")), raw);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  await assert.rejects(mountMcp(express(), {
    facilitatorClient: facilitator, network: NETWORK, payTo: PAY_TO,
    serverInfo: { name: "duplicate", version: "0" },
    tools: [
      { name: TRIAL_READ_MCP_TOOL, free: true, description: "first", price: "$0", inputSchema: { url: z.string() }, run: async () => ({ ok: true, charged: false }) },
      { name: TRIAL_READ_MCP_TOOL, free: true, description: "duplicate", price: "$0", inputSchema: { url: z.string() }, run: async () => ({ ok: false, charged: false }) },
    ],
  }), /collides/);
});
