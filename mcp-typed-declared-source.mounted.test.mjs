import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";

import {
  createCommerceTelemetry,
  isCanonicalMcpTypedCommerceEvent,
} from "./commerce-events.mjs";
import { mountMcp } from "./mcp-server.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

const NETWORK = "eip155:84532";
const PAY_TO = "0x2000000000000000000000000000000000000002";
const PAYER = "0x1000000000000000000000000000000000000001";
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});
const SOURCE_HEADER = "x-samedaydesk-agent-source";

function payment(accepted) {
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  };
}

function createFacilitator(calls, policy = {}) {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
    },
    async verify() {
      calls.verify += 1;
      if (typeof policy.verify === "function") return policy.verify();
      return { isValid: true, payer: PAYER };
    },
    async settle() {
      calls.settle += 1;
      if (typeof policy.settle === "function") return policy.settle();
      return { success: true, transaction: `0x${"33".repeat(32)}`, network: NETWORK };
    },
  };
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function initializeBody(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "c30-declared-source", version: "1" },
    },
  };
}

async function startDeclaredSourceMounted(options = {}) {
  const calls = { verify: 0, settle: 0, handler: {}, innerHeaders: [] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") {
      throw new Error("external network blocked");
    }
    return originalFetch(input, init);
  };
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "mcp-typed-declared-source-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "mounted-declared-source-secret",
    writerProcessCount: 1,
    mcpTypedSince: "2026-01-01T00:00:00.000Z",
    mcpTypedFreshnessMaxAgeMs: 900_000,
  });
  const app = express();
  app.use(telemetry.middleware);
  app.post("/inner-paid", (req, res) => {
    calls.innerHeaders.push({
      source: req.headers[SOURCE_HEADER] ?? null,
      payment: Boolean(req.headers["payment-signature"] || req.headers["x-payment"]),
    });
    res.status(402).json({ error: "Payment Required" });
  });
  const tools = options.tools || [{
    name: "extract",
    description: "synthetic extract",
    price: "$0.05",
    inputSchema: { url: z.string() },
    run: async (args) => {
      calls.handler.extract = (calls.handler.extract || 0) + 1;
      if (args?.url === "https://fail.invalid") throw new Error("synthetic-extract-failure");
      return { ok: true, url: "redacted" };
    },
  }];
  if (options.paidHttp) {
    tools.push({
      name: "extract_batch",
      description: "synthetic paidHttp extract_batch",
      price: "$0.03",
      inputSchema: { url: z.string() },
      paidHttp: {
        method: "POST",
        path: "/inner-paid",
        resourceUrl: "https://agents.samedaydesk.com/inner-paid",
        maxRequestBytes: 16 * 1024,
        maxResponseBytes: 160 * 1024,
      },
      run: async () => ({ ok: true }),
    });
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mountResult = await mountMcp(app, {
    httpBaseUrl: origin,
    facilitatorClient: createFacilitator(calls, options.facilitator),
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "typed-declared-source", version: "1" },
    streamableHttpOptions: { enableJsonResponse: true },
    tools,
    typedTelemetry: {
      enabled: true,
      onAppend: (decision, requestAttribution, declaredSource) =>
        telemetry.appendMcpTypedDecision(decision, requestAttribution, declaredSource),
      attributionForRequest: (req) => telemetry.mcpTypedAttributionForRequest(req),
      declaredSourceForRequest: (req) => telemetry.mcpTypedDeclaredSourceForRequest(req),
    },
  });
  return {
    origin,
    calls,
    telemetry,
    mountResult,
    async drain() {
      await mountResult.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 });
      await telemetry.flush();
    },
    async rows() {
      await this.drain();
      const raw = await readFile(telemetry.paths.currentPath, "utf8").catch(() => "");
      return raw.trim().split("\n").filter(Boolean).map(JSON.parse);
    },
    async close() {
      globalThis.fetch = originalFetch;
      await closeServer(server);
      await mountResult.typedTelemetryLifecycle.shutdown({ timeoutMs: 250 }).catch(() => {});
      await telemetry.flush();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function postMcp(origin, body, extraHeaders = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { ...MCP_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buffer.toString("utf8")); } catch { json = null; }
  return { status: response.status, json, body: buffer };
}

function extractCall(id, url = "https://example.invalid") {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "extract", arguments: { url } },
  };
}

function paidExtract(id, accepted, url = "https://example.invalid") {
  const body = extractCall(id, url);
  body.params._meta = { "x402/payment": payment(accepted) };
  return body;
}

async function unpaidAccepts(origin, extraHeaders = {}) {
  const unpaid = await postMcp(origin, extractCall(11), extraHeaders);
  const accepts = unpaid.json?.result?.structuredContent?.accepts?.[0]
    || (unpaid.json?.result?.content?.[0]?.text && JSON.parse(unpaid.json.result.content[0].text).accepts?.[0]);
  assert.ok(accepts, "unpaid extract did not return issued accepts");
  return { unpaid, accepts };
}

test("initialize and tools/list with a declared source invent no typed tool events", { timeout: 20_000 }, async () => {
  const instance = await startDeclaredSourceMounted();
  try {
    const headers = { [SOURCE_HEADER]: "agent-skills-v1" };
    const initialized = await postMcp(instance.origin, initializeBody(1), headers);
    const listed = await postMcp(instance.origin, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }, headers);
    assert.equal(initialized.status, 200);
    assert.equal(listed.status, 200);
    assert.equal(initialized.json?.result?.serverInfo?.name, "typed-declared-source");
    assert.ok((listed.json?.result?.tools || []).some((tool) => tool.name === "extract"));
    const rows = await instance.rows();
    assert.equal(rows.length, 0);
    const snapshot = await instance.telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.parseableRecordCount, 0);
    assert.equal(snapshot.retainedParseableEventCount, 0);
    assert.equal(snapshot.agentSourceFunnel?.["agent-skills"], undefined);
  } finally {
    await instance.close();
  }
});

test("direct extract challenge retains allowlisted source and ignores malformed input", { timeout: 20_000 }, async () => {
  const instance = await startDeclaredSourceMounted();
  try {
    const sourced = await postMcp(instance.origin, extractCall(31), {
      [SOURCE_HEADER]: "agent-skills-v1",
    });
    const ignored = await postMcp(instance.origin, extractCall(32), {
      [SOURCE_HEADER]: "not-a-real-source",
    });
    const absent = await postMcp(instance.origin, extractCall(33));
    assert.equal(sourced.status, 200);
    assert.equal(ignored.status, 200);
    assert.equal(absent.status, 200);
    const rows = await instance.rows();
    const typed = rows.filter((row) => row.sourceContract === "mcp_typed_outcome");
    const http = rows.filter((row) => row.v === 3);
    assert.equal(typed.length, 3);
    assert.equal(http.length, 0);
    assert.equal(typed.every((row) => row.result === "challenge"), true);
    assert.equal(typed.every((row) => isCanonicalMcpTypedCommerceEvent(row)), true);
    assert.equal(typed[0].declaredAgentDiscoverySource, "agent-skills");
    assert.equal(typed[0].binding.tool, "extract");
    assert.equal(Object.hasOwn(typed[1], "declaredAgentDiscoverySource"), false);
    assert.equal(Object.hasOwn(typed[2], "declaredAgentDiscoverySource"), false);
    assert.equal(typed.every((row) => row.demand === false && row.revenue === false), true);
    const raw = JSON.stringify(rows);
    assert.equal(raw.includes("agent-skills-v1"), false);
    assert.equal(raw.includes("not-a-real-source"), false);
    const snapshot = await instance.telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.byDeclaredSource["agent-skills"], 1);
    assert.equal(snapshot.mcpTyped.byTool.extract, 3);
    assert.equal(snapshot.agentSourceFunnel?.["agent-skills"], undefined);
    assert.equal(snapshot.retainedParseableEventCount, 0);
  } finally {
    await instance.close();
  }
});

test("concurrent sourced and no-source extract calls do not leak ALS or request context", { timeout: 20_000 }, async () => {
  const instance = await startDeclaredSourceMounted();
  try {
    const [skills, trade, none] = await Promise.all([
      postMcp(instance.origin, extractCall(41), { [SOURCE_HEADER]: "agent-skills-v1" }),
      postMcp(instance.origin, extractCall(42), { [SOURCE_HEADER]: "agentictrade-v1" }),
      postMcp(instance.origin, extractCall(43)),
    ]);
    assert.equal(skills.status, 200);
    assert.equal(trade.status, 200);
    assert.equal(none.status, 200);
    const typed = (await instance.rows()).filter((row) => row.sourceContract === "mcp_typed_outcome");
    assert.equal(typed.length, 3);
    const byIdTool = typed.map((row) => row.declaredAgentDiscoverySource ?? null).sort();
    assert.deepEqual(byIdTool, ["agent-skills", "agentictrade", null].sort());
    assert.equal(typed.filter((row) => row.declaredAgentDiscoverySource === "agent-skills").length, 1);
    assert.equal(typed.filter((row) => row.declaredAgentDiscoverySource === "agentictrade").length, 1);
    assert.equal(typed.filter((row) => !Object.hasOwn(row, "declaredAgentDiscoverySource")).length, 1);
    const snapshot = await instance.telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.byDeclaredSource["agent-skills"], 1);
    assert.equal(snapshot.mcpTyped.byDeclaredSource.agentictrade, 1);
    assert.equal(snapshot.agentSourceFunnel?.["agent-skills"], undefined);
    assert.equal(snapshot.agentSourceFunnel?.agentictrade, undefined);
  } finally {
    await instance.close();
  }
});

test("paid extract success and handler error keep declared source off payment and HTTP funnels", { timeout: 20_000 }, async () => {
  const instance = await startDeclaredSourceMounted();
  try {
    const headers = { [SOURCE_HEADER]: "agent-skills-v1" };
    const { accepts } = await unpaidAccepts(instance.origin, headers);
    const paid = await postMcp(instance.origin, paidExtract(52, accepts), headers);
    const { accepts: failAccepts } = await unpaidAccepts(instance.origin, headers);
    const failed = await postMcp(
      instance.origin,
      paidExtract(53, failAccepts, "https://fail.invalid"),
      headers,
    );
    assert.equal(paid.status, 200);
    assert.equal(failed.status, 200);
    const rows = await instance.rows();
    const typed = rows.filter((row) => row.sourceContract === "mcp_typed_outcome");
    const http = rows.filter((row) => row.v === 3);
    assert.equal(http.length, 0);
    const success = typed.find((row) => row.result === "paid_success");
    const error = typed.find((row) => row.result === "application_failure");
    const challenges = typed.filter((row) => row.result === "challenge");
    assert.ok(success);
    assert.ok(error);
    assert.equal(challenges.length, 2);
    assert.equal(success.declaredAgentDiscoverySource, "agent-skills");
    assert.equal(error.declaredAgentDiscoverySource, "agent-skills");
    assert.equal(success.demand, false);
    assert.equal(success.revenue, false);
    assert.equal(success.payerIdentity, false);
    assert.equal(isCanonicalMcpTypedCommerceEvent(success), true);
    const snapshot = await instance.telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.byResult.paid_success, 1);
    assert.equal(snapshot.mcpTyped.byResult.application_failure, 1);
    assert.equal(snapshot.mcpTyped.byDeclaredSource["agent-skills"], typed.length);
    assert.equal(snapshot.agentSourceFunnel?.["agent-skills"], undefined);
    assert.equal(JSON.stringify(rows).includes("synthetic-extract-failure"), false);
  } finally {
    await instance.close();
  }
});

test("composed paidHttp batch bridge retains source only on its HTTP plane", { timeout: 20_000 }, async () => {
  const instance = await startDeclaredSourceMounted({ paidHttp: true });
  try {
    const sourced = await postMcp(instance.origin, {
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: { name: "extract_batch", arguments: { url: "https://example.invalid" } },
    }, { [SOURCE_HEADER]: "agent-skills-v1" });
    assert.equal(sourced.status, 200);
    const rows = await instance.rows();
    const typed = rows.filter((row) => row.sourceContract === "mcp_typed_outcome");
    const httpMcp = rows.filter((row) => row.v === 3 && row.route === "/mcp");
    const httpInner = rows.filter((row) => row.v === 3 && row.route !== "/mcp");
    assert.equal(httpMcp.length, 0);
    assert.equal(typed.every((row) => row.action === "drop" && !Object.hasOwn(row, "declaredAgentDiscoverySource")), true);
    assert.equal(instance.calls.innerHeaders.length, 1);
    assert.equal(instance.calls.innerHeaders[0].source, "agent-skills-v1");
    assert.equal(httpInner.length, 1);
    for (const event of httpInner) {
      assert.equal(event.declaredAgentDiscoverySource, "agent-skills");
    }
    const snapshot = await instance.telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.byDeclaredSource["agent-skills"], undefined);
    assert.equal(snapshot.agentSourceFunnel?.["agent-skills"], undefined);
  } finally {
    await instance.close();
  }
});
