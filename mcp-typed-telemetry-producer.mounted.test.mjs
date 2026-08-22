import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import {
  adaptMcpTypedDecisionToCommerceEvent,
  createCommerceTelemetry,
  isCanonicalMcpTypedCommerceEvent,
} from "./commerce-events.mjs";
import { mountMcp } from "./mcp-server.mjs";
import {
  createMcpTypedTelemetryAttempt,
  evaluateMcpTypedTelemetryOutcome,
} from "./mcp-typed-telemetry-producer.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

const NETWORK = "eip155:84532";
const PAY_TO = "0x2000000000000000000000000000000000000002";
const PAYER = "0x1000000000000000000000000000000000000001";
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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

function installNetworkGuard(calls) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") {
      calls.external += 1;
      throw new Error("external network blocked");
    }
    calls.loopback += 1;
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function wrapResponse(res, { split = "identity", capture }) {
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const origSetHeader = res.setHeader.bind(res);
  const chunks = [];
  const orderedHeaders = [];
  res.setHeader = (name, value) => {
    orderedHeaders.push([String(name), value]);
    return origSetHeader(name, value);
  };
  const emit = (chunk, encoding) => {
    if (chunk === undefined || chunk === null) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8");
    chunks.push(buf);
    if (split === "one-byte") {
      for (let index = 0; index < buf.length; index += 1) origWrite(buf.subarray(index, index + 1));
      return true;
    }
    if (split === "half") {
      const mid = Math.max(1, Math.floor(buf.length / 2));
      if (buf.length > 1) {
        origWrite(buf.subarray(0, mid));
        origWrite(buf.subarray(mid));
        return true;
      }
    }
    return origWrite(buf);
  };
  res.write = (chunk, encoding, cb) => {
    const result = emit(chunk, encoding);
    if (typeof encoding === "function") encoding();
    else if (typeof cb === "function") cb();
    return result;
  };
  res.end = (chunk, encoding, cb) => {
    if (chunk && typeof chunk !== "function") emit(chunk, encoding);
    const done = typeof chunk === "function" ? chunk : typeof encoding === "function" ? encoding : cb;
    const result = origEnd(done);
    capture.body = Buffer.concat(chunks);
    capture.orderedHeaders = orderedHeaders.slice();
    capture.status = Number(res.statusCode || 0);
    return result;
  };
}

function decodeMcpBody(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payload = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("");
    return payload ? JSON.parse(payload) : null;
  }
  return JSON.parse(text);
}

function comparableHeaders(headers) {
  return (headers || [])
    .filter(([name]) => !["date", "etag", "keep-alive", "connection"].includes(String(name).toLowerCase()))
    .map(([name, value]) => [String(name).toLowerCase(), value]);
}

function receiptOf(capture, calls, events) {
  return {
    status: capture.status,
    bodyHash: sha256(capture.body || Buffer.alloc(0)),
    headers: comparableHeaders(capture.orderedHeaders.length ? capture.orderedHeaders : capture.headers || []),
    sequence: [...calls.sequence],
    eventResults: events.map((event) => event.result),
    eventCount: events.length,
  };
}

function createFacilitator(calls, policy = {}) {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
    },
    async verify() {
      calls.verify += 1;
      calls.sequence.push("verify");
      if (typeof policy.verify === "function") return policy.verify();
      return { isValid: true, payer: PAYER };
    },
    async settle() {
      calls.settle += 1;
      calls.sequence.push("settle");
      if (typeof policy.settle === "function") return policy.settle();
      return { success: true, transaction: `0x${"33".repeat(32)}`, network: NETWORK };
    },
  };
}

function createTools(calls) {
  const count = (name) => {
    calls.handler[name] = (calls.handler[name] || 0) + 1;
    calls.sequence.push(`handler:${name}`);
  };
  return [
    {
      name: "enrich",
      description: "synthetic enrich",
      price: "$0.02",
      inputSchema: { domain: z.string() },
      run: async () => {
        count("enrich");
        return { ok: true };
      },
    },
    {
      name: "read",
      description: "synthetic read",
      price: "$0.03",
      inputSchema: { url: z.string() },
      returnMcpResult: true,
      run: async () => {
        count("read");
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false }) }],
          isError: true,
        };
      },
    },
    {
      name: "scan",
      description: "synthetic scan",
      price: "$0.04",
      inputSchema: { repo: z.string() },
      run: async () => {
        count("scan");
        throw new Error("synthetic-handler-failure");
      },
    },
    {
      name: "schemaforge",
      description: "synthetic schemaforge",
      price: "$0.05",
      inputSchema: { site: z.string() },
      run: async () => {
        count("schemaforge");
        return { ok: true, tool: "schemaforge" };
      },
    },
  ];
}

async function startMounted(options = {}) {
  const calls = {
    verify: 0,
    settle: 0,
    handler: {},
    sequence: [],
    external: 0,
    loopback: 0,
  };
  const events = [];
  const restoreFetch = installNetworkGuard(calls);
  const app = express();
  if (options.httpRoutes) {
    app.get("/openapi.json", (_req, res) => res.status(200).json({ openapi: "3.1.0" }));
    app.get("/enrich", (_req, res) => res.status(402).json({ error: "Payment Required" }));
    app.post("/security/wallet-policy-conformance", (_req, res) => res.status(402).json({ error: "Payment Required" }));
  }
  let commerce = null;
  let dataDir = null;
  if (options.commerce) {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "mcp-typed-mounted-"));
    commerce = createCommerceTelemetry({
      dataDir,
      secret: "mounted-typed-producer-secret",
    });
    app.use(commerce.middleware);
  }
  const capture = { body: Buffer.alloc(0), orderedHeaders: [], headers: [], status: 0 };
  if (options.wrapResponse !== false) {
    app.use((_req, res, next) => {
      wrapResponse(res, { split: options.split || "identity", capture });
      next();
    });
  }
  const mount = await mountMcp(app, {
    facilitatorClient: createFacilitator(calls, options.facilitator),
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "typed-producer-mounted", version: "1" },
    tools: options.tools || createTools(calls),
    streamableHttpOptions: options.streamableHttpOptions,
    configureResourceServer: options.configureResourceServer,
    typedTelemetry: {
      enabled: options.typedEnabled === true,
      onAppend: (decision) => {
        events.push(decision);
        if (typeof options.onAppend === "function") return options.onAppend(decision);
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    calls,
    events,
    capture,
    catalog: mount.catalog,
    mountResult: mount,
    commerce,
    dataDir,
    async drain({ timeoutMs = 1_000 } = {}) {
      const lifecycle = mount.typedTelemetryLifecycle;
      if (typeof lifecycle?.flush === "function") {
        return lifecycle.flush({ timeoutMs });
      }
      return { drained: true, pending: 0, failures: 0 };
    },
    async close() {
      restoreFetch();
      await closeServer(server);
      const lifecycle = mount.typedTelemetryLifecycle;
      if (typeof lifecycle?.shutdown === "function") {
        await lifecycle.shutdown({ timeoutMs: 250 }).catch(() => {});
      }
      await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
      if (commerce) await commerce.flush();
      if (dataDir) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function postMcp(origin, body) {
  const started = Date.now();
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: [...response.headers.entries()],
    body: buffer,
    json: decodeMcpBody(buffer, response.headers.get("content-type")),
    durationMs: Date.now() - started,
  };
}

function paidCall(id, name, argumentKey, argumentValue, accepted) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      arguments: { [argumentKey]: argumentValue },
      _meta: { "x402/payment": payment(accepted) },
    },
  };
}

async function unpaidAccepts(origin, name, argumentKey, argumentValue, id = 1) {
  const unpaid = await postMcp(origin, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: { [argumentKey]: argumentValue } },
  });
  const accepts = unpaid.json?.result?.structuredContent?.accepts?.[0]
    || unpaid.json?.result?.content?.[0]?.text && JSON.parse(unpaid.json.result.content[0].text).accepts?.[0];
  assert.ok(accepts, `unpaid ${name} did not return issued accepts`);
  return { unpaid, accepts };
}

test("M01 unpaid exact registered call is one challenge", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  const disabled = await startMounted({ typedEnabled: false });
  try {
    const paid = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 11);
    const off = await unpaidAccepts(disabled.origin, "enrich", "domain", "example.invalid", 11);
    await enabled.drain();
    assert.equal(paid.unpaid.status, off.unpaid.status);
    assert.equal(sha256(paid.unpaid.body), sha256(off.unpaid.body));
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "challenge");
    assert.equal(enabled.events[0].reason, "typed_payment_required");
    assert.equal(enabled.calls.handler.enrich || 0, 0);
    assert.equal(enabled.calls.verify, 0);
    assert.equal(enabled.calls.settle, 0);
    assert.equal(disabled.events.length, 0);
  } finally {
    await enabled.close();
    await disabled.close();
  }
});

test("M02 verified handler success plus settlement success is paid_success", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  const disabled = await startMounted({ typedEnabled: false });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 20);
    const { accepts: disabledAccepts } = await unpaidAccepts(disabled.origin, "enrich", "domain", "example.invalid", 20);
    await enabled.drain();
    enabled.events.length = 0;
    enabled.calls.sequence.length = 0;
    disabled.calls.sequence.length = 0;
    const on = await postMcp(enabled.origin, paidCall(21, "enrich", "domain", "example.invalid", accepts));
    const off = await postMcp(disabled.origin, paidCall(21, "enrich", "domain", "example.invalid", disabledAccepts));
    await enabled.drain();
    assert.equal(on.status, off.status);
    assert.equal(sha256(on.body), sha256(off.body));
    assert.deepEqual(enabled.calls.sequence, disabled.calls.sequence);
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "paid_success");
    assert.equal(enabled.events[0].handlerInvoked, true);
    assert.equal(enabled.events[0].settlementState, "succeeded");
    assert.equal(enabled.calls.handler.enrich, 1);
    assert.equal(enabled.calls.verify, 1);
    assert.equal(enabled.calls.settle, 1);
    assert.equal(disabled.events.length, 0);
    assert.equal(JSON.stringify(enabled.events[0]).includes("example.invalid"), false);
  } finally {
    await enabled.close();
    await disabled.close();
  }
});

test("M03 handler isError:true is application_failure never paid_success", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "read", "url", "https://example.invalid", 30);
    await enabled.drain();
    enabled.events.length = 0;
    const on = await postMcp(enabled.origin, paidCall(31, "read", "url", "https://example.invalid", accepts));
    await enabled.drain();
    assert.equal(on.status, 200);
    assert.equal(on.json?.result?.isError, true);
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "application_failure");
    assert.notEqual(enabled.events[0].result, "paid_success");
    assert.equal(enabled.calls.handler.read, 1);
    assert.equal(enabled.calls.settle, 0);
    const inferred = on.json?.result?.isError && on.status === 200 ? "would-have-been-paid-by-http-2xx" : null;
    assert.equal(inferred, "would-have-been-paid-by-http-2xx");
  } finally {
    await enabled.close();
  }
});

test("M04 handler throw is application_failure and retains no error text", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "scan", "repo", "org/example", 40);
    await enabled.drain();
    enabled.events.length = 0;
    const on = await postMcp(enabled.origin, paidCall(41, "scan", "repo", "org/example", accepts));
    await enabled.drain();
    assert.equal(on.json?.result?.isError, true);
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "application_failure");
    assert.equal(JSON.stringify(enabled.events[0]).includes("synthetic-handler-failure"), false);
    assert.equal(enabled.calls.settle, 0);
  } finally {
    await enabled.close();
  }
});

test("M05 verifier rejection is challenge never paid_success", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({
    typedEnabled: true,
    facilitator: { verify: () => ({ isValid: false, invalidReason: "synthetic-reject" }) },
  });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 50);
    await enabled.drain();
    enabled.events.length = 0;
    enabled.calls.sequence.length = 0;
    const on = await postMcp(enabled.origin, paidCall(51, "enrich", "domain", "example.invalid", accepts));
    await enabled.drain();
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "challenge");
    assert.notEqual(enabled.events[0].result, "paid_success");
    assert.equal(enabled.calls.handler.enrich || 0, 0);
    assert.equal(enabled.calls.verify, 1);
    assert.equal(enabled.calls.settle, 0);
    assert.equal(JSON.stringify(enabled.events[0]).includes("synthetic-reject"), false);
    assert.ok(on.json);
  } finally {
    await enabled.close();
  }
});

test("M06 settlement failed and unknown never paid_success", { timeout: 20_000 }, async () => {
  const failed = await startMounted({
    typedEnabled: true,
    facilitator: { settle: () => ({ success: false, errorReason: "synthetic-fail", transaction: "", network: NETWORK }) },
  });
  const unknown = await startMounted({
    typedEnabled: true,
    facilitator: { settle: () => ({ transaction: "", network: NETWORK }) },
  });
  try {
    const { accepts } = await unpaidAccepts(failed.origin, "enrich", "domain", "example.invalid", 60);
    await failed.drain();
    failed.events.length = 0;
    await postMcp(failed.origin, paidCall(61, "enrich", "domain", "example.invalid", accepts));
    await failed.drain();
    assert.equal(failed.events[0].result, "settlement_failure");
    assert.notEqual(failed.events[0].result, "paid_success");

    const { accepts: unknownAccepts } = await unpaidAccepts(unknown.origin, "enrich", "domain", "example.invalid", 62);
    await unknown.drain();
    unknown.events.length = 0;
    await postMcp(unknown.origin, paidCall(63, "enrich", "domain", "example.invalid", unknownAccepts));
    await unknown.drain();
    assert.equal(unknown.events[0].result, "telemetry_incomplete");
    assert.equal(unknown.events[0].settlementState, "unknown");
    assert.notEqual(unknown.events[0].result, "paid_success");
  } finally {
    await failed.close();
    await unknown.close();
  }
});

test("M07 no-ID notification with forged payment never paid_success", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  const disabled = await startMounted({ typedEnabled: false });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 70);
    await enabled.drain();
    enabled.events.length = 0;
    const notification = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "enrich",
        arguments: { domain: "notification.invalid" },
        _meta: { "x402/payment": payment(accepts) },
      },
    };
    const on = await postMcp(enabled.origin, notification);
    const off = await postMcp(disabled.origin, notification);
    await enabled.drain();
    assert.equal(on.status, 202);
    assert.equal(off.status, 202);
    assert.equal(on.body.length, 0);
    assert.equal(off.body.length, 0);
    assert.equal(enabled.calls.handler.enrich || 0, 0);
    assert.equal(enabled.calls.verify, 0);
    assert.equal(enabled.calls.settle, 0);
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "protocol_discovery");
    assert.notEqual(enabled.events[0].result, "paid_success");
    assert.equal(enabled.events[0].paymentPresent, false);
  } finally {
    await enabled.close();
    await disabled.close();
  }
});

test("M08 numeric and string IDs bind exactly; type mismatch drops", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 80);
    await enabled.drain();
    enabled.events.length = 0;
    await postMcp(enabled.origin, paidCall(81, "enrich", "domain", "example.invalid", accepts));
    await postMcp(enabled.origin, paidCall("req-81", "enrich", "domain", "example.invalid", accepts));
    await enabled.drain();
    assert.equal(enabled.events[0].result, "paid_success");
    assert.equal(enabled.events[1].result, "paid_success");
    const digest = enabled.events[0].binding.issuedOfferDigest;
    const mismatch = createMcpTypedTelemetryAttempt({
      binding: enabled.events[0].binding,
      request: { jsonrpc: "2.0", hasId: true, id: 81, method: "tools/call" },
    });
    mismatch.credentialVerified({ offerDigest: digest });
    mismatch.handlerStarted();
    mismatch.handlerFinished({ isError: false });
    mismatch.settlementFinished({ state: "succeeded", offerDigest: digest });
    const dropped = mismatch.finalize({ responseId: "81", kind: "tool_result" });
    assert.equal(dropped.result, "invalid");
    assert.notEqual(dropped.result, "paid_success");
  } finally {
    await enabled.close();
  }
});

test("M09 absent wrong unsafe and null IDs never succeed", () => {
  const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const binding = {
    tool: "enrich",
    productSku: "samedaydesk-enrich",
    resource: "mcp://tool/enrich",
    issuedOfferDigest: digest,
  };
  const base = {
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding,
    request: { jsonrpc: "2.0", hasId: true, id: 9, method: "tools/call" },
    credential: { state: "verified", offerDigest: digest },
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
    settlement: { state: "succeeded", offerDigest: digest },
  };
  for (const [title, response] of [
    ["absent", { hasId: false, id: null, kind: "tool_result" }],
    ["wrong", { hasId: true, id: 99, kind: "tool_result" }],
    ["null", { hasId: true, id: null, kind: "tool_result" }],
  ]) {
    const output = evaluateMcpTypedTelemetryOutcome({ ...base, response });
    assert.equal(output.result, "invalid", title);
    assert.notEqual(output.result, "paid_success", title);
  }
  const unsafe = evaluateMcpTypedTelemetryOutcome({
    ...base,
    request: { jsonrpc: "2.0", hasId: true, id: 9007199254740992, method: "tools/call" },
    response: { hasId: true, id: 9007199254740992, kind: "tool_result" },
  });
  assert.equal(unsafe.result, "invalid");
});

test("M10 each tool SKU resource credential-offer and settlement-offer mismatch drops", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const unknown = await postMcp(enabled.origin, {
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: { name: "not_a_registered_tool", arguments: { secret: "never-store" } },
    });
    await enabled.drain();
    assert.ok(unknown.status === 200 || unknown.status === 400);
    assert.equal(enabled.events.at(-1).result, "invalid");
    assert.equal(enabled.events.at(-1).reason, "invalid_catalog_binding");
    assert.equal(JSON.stringify(enabled.events).includes("not_a_registered_tool"), false);
    assert.equal(JSON.stringify(enabled.events).includes("never-store"), false);

    const digest = enabled.catalog.enrich.issuedOfferDigest;
    const binding = enabled.catalog.enrich;
    const cases = [
      ["tool", { ...binding, tool: "read" }],
      ["sku", { ...binding, productSku: "samedaydesk-read" }],
      ["resource", { ...binding, resource: "mcp://tool/read" }],
    ];
    for (const [dimension, nextBinding] of cases) {
      const output = evaluateMcpTypedTelemetryOutcome({
        schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
        binding: nextBinding,
        request: { jsonrpc: "2.0", hasId: true, id: 1, method: "tools/call" },
        response: { hasId: true, id: 1, kind: "tool_result" },
        credential: { state: "verified", offerDigest: digest },
        execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
        settlement: { state: "succeeded", offerDigest: digest },
      });
      assert.equal(output.result, "invalid", dimension);
      assert.notEqual(output.result, "paid_success", dimension);
    }
  } finally {
    await enabled.close();
  }
});

test("M11 explicit wrapper replay path is replay_success never paid_success", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({
    typedEnabled: true,
    configureResourceServer(resourceServer) {
      resourceServer.onAfterVerify(() => ({
        skipHandler: true,
        response: { body: { ok: true } },
      }));
    },
  });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 110);
    await enabled.drain();
    enabled.events.length = 0;
    enabled.calls.sequence.length = 0;
    const on = await postMcp(enabled.origin, paidCall(111, "enrich", "domain", "example.invalid", accepts));
    await enabled.drain();
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "replay_success");
    assert.notEqual(enabled.events[0].result, "paid_success");
    assert.equal(enabled.calls.handler.enrich || 0, 0);
    assert.equal(enabled.calls.verify, 1);
    assert.equal(enabled.calls.settle, 1);
    assert.equal(on.json?.result?.isError, undefined);
  } finally {
    await enabled.close();
  }
});

test("M12 JSON and SSE write boundaries yield identical typed results", { timeout: 30_000 }, async () => {
  const modes = ["identity", "one-byte", "half"];
  const jsonDecisions = [];
  const sseDecisions = [];
  for (const split of modes) {
    const jsonApp = await startMounted({
      typedEnabled: true,
      split,
      streamableHttpOptions: { enableJsonResponse: true },
    });
    const sseApp = await startMounted({ typedEnabled: true, split });
    try {
      const { accepts } = await unpaidAccepts(jsonApp.origin, "enrich", "domain", "example.invalid", 120);
      await jsonApp.drain();
      jsonApp.events.length = 0;
      await postMcp(jsonApp.origin, paidCall(121, "enrich", "domain", "example.invalid", accepts));
      await jsonApp.drain();
      jsonDecisions.push(jsonApp.events[0]);

      const sseUnpaid = await unpaidAccepts(sseApp.origin, "enrich", "domain", "example.invalid", 122);
      await sseApp.drain();
      sseApp.events.length = 0;
      await postMcp(sseApp.origin, paidCall(123, "enrich", "domain", "example.invalid", sseUnpaid.accepts));
      await sseApp.drain();
      sseDecisions.push(sseApp.events[0]);
    } finally {
      await jsonApp.close();
      await sseApp.close();
    }
  }
  for (const decision of [...jsonDecisions, ...sseDecisions]) {
    assert.equal(decision.result, "paid_success");
  }
  assert.equal(new Set(jsonDecisions.map((decision) => JSON.stringify(decision))).size, 1);
  assert.equal(new Set(sseDecisions.map((decision) => JSON.stringify(decision))).size, 1);
});

test("M13 finish close and second finalize append at most once", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 130);
    await enabled.drain();
    enabled.events.length = 0;
    await postMcp(enabled.origin, paidCall(131, "enrich", "domain", "example.invalid", accepts));
    await enabled.drain();
    assert.equal(enabled.events.length, 1);
    const attempt = createMcpTypedTelemetryAttempt({
      binding: enabled.events[0].binding,
      request: { jsonrpc: "2.0", hasId: true, id: 131, method: "tools/call" },
      onAppend: (decision) => enabled.events.push(decision),
    });
    attempt.credentialVerified({ offerDigest: enabled.events[0].binding.issuedOfferDigest });
    attempt.handlerStarted();
    attempt.handlerFinished({ isError: false });
    attempt.settlementFinished({
      state: "succeeded",
      offerDigest: enabled.events[0].binding.issuedOfferDigest,
    });
    attempt.finalize({ responseId: 131, kind: "tool_result" });
    attempt.finalize({ responseId: 131, kind: "tool_result" });
    await Promise.resolve();
    assert.equal(enabled.events.length, 2);
  } finally {
    await enabled.close();
  }
});

test("M14 32 interleaved requests with repeated IDs do not cross-wire", { timeout: 30_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const enrich = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 1);
    const schema = await unpaidAccepts(enabled.origin, "schemaforge", "site", "https://example.invalid", 2);
    await enabled.drain();
    enabled.events.length = 0;
    enabled.calls.sequence.length = 0;
    const jobs = [];
    for (let index = 0; index < 32; index += 1) {
      const enrichCall = index % 2 === 0;
      jobs.push(postMcp(
        enabled.origin,
        enrichCall
          ? paidCall(7, "enrich", "domain", "example.invalid", enrich.accepts)
          : paidCall(7, "schemaforge", "site", "https://example.invalid", schema.accepts),
      ));
    }
    await Promise.all(jobs);
    await enabled.drain();
    assert.equal(enabled.events.length, 32);
    const enrichRows = enabled.events.filter((event) => event.binding.tool === "enrich");
    const schemaRows = enabled.events.filter((event) => event.binding.tool === "schemaforge");
    assert.equal(enrichRows.length, 16);
    assert.equal(schemaRows.length, 16);
    assert.equal(new Set(enrichRows.map((event) => event.binding.issuedOfferDigest)).size, 1);
    assert.equal(new Set(schemaRows.map((event) => event.binding.issuedOfferDigest)).size, 1);
    assert.notEqual(enrichRows[0].binding.issuedOfferDigest, schemaRows[0].binding.issuedOfferDigest);
    assert.ok(enrichRows.every((event) => event.result === "paid_success"));
    assert.ok(schemaRows.every((event) => event.result === "paid_success"));
    assert.equal(enabled.calls.handler.enrich, 16);
    assert.equal(enabled.calls.handler.schemaforge, 16);
  } finally {
    await enabled.close();
  }
});

test("M15 append throw reject and blocked promise keep response invariance", { timeout: 20_000 }, async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const throwing = await startMounted({
    typedEnabled: true,
    onAppend() { throw new Error("append-throw-secret"); },
  });
  const hanging = await startMounted({
    typedEnabled: true,
    onAppend() { return blocked; },
  });
  const disabled = await startMounted({ typedEnabled: false });
  try {
    const { accepts } = await unpaidAccepts(throwing.origin, "enrich", "domain", "example.invalid", 150);
    const { accepts: hangAccepts } = await unpaidAccepts(hanging.origin, "enrich", "domain", "example.invalid", 150);
    const { accepts: offAccepts } = await unpaidAccepts(disabled.origin, "enrich", "domain", "example.invalid", 150);
    throwing.events.length = 0;
    hanging.events.length = 0;
    const thrown = await postMcp(throwing.origin, paidCall(151, "enrich", "domain", "example.invalid", accepts));
    const hungStarted = Date.now();
    const hung = await postMcp(hanging.origin, paidCall(151, "enrich", "domain", "example.invalid", hangAccepts));
    const hungDuration = Date.now() - hungStarted;
    const off = await postMcp(disabled.origin, paidCall(151, "enrich", "domain", "example.invalid", offAccepts));
    assert.equal(thrown.status, off.status);
    assert.equal(hung.status, off.status);
    assert.equal(sha256(thrown.body), sha256(off.body));
    assert.equal(sha256(hung.body), sha256(off.body));
    assert.ok(hungDuration < 1000, `blocked append delayed the response: ${hungDuration}`);
    assert.equal(JSON.stringify(throwing.events).includes("append-throw-secret"), false);
  } finally {
    release?.();
    await throwing.close();
    await hanging.close();
    await disabled.close();
  }
});

test("M16 initialize list ping malformed and unknown method emit zero economic events", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const client = new Client({ name: "typed-producer-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${enabled.origin}/mcp`)));
    const tools = await client.listTools();
    assert.ok(tools.tools.length >= 4);
    await client.ping();
    await client.close();
    await enabled.drain();
    enabled.events.length = 0;
    const malformed = await fetch(`${enabled.origin}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: "{not-json",
    });
    assert.ok(malformed.status >= 400);
    const unknown = await postMcp(enabled.origin, {
      jsonrpc: "2.0",
      id: 160,
      method: "nope/nope",
      params: {},
    });
    await enabled.drain();
    assert.ok(unknown.json);
    const economic = enabled.events.filter((event) => event.result !== "protocol_discovery");
    assert.equal(economic.length, 0);
    assert.ok(enabled.events.every((event) => event.result !== "paid_success"));
  } finally {
    await enabled.close();
  }
});

test("M17 representative free and paid HTTP routes stay isolated", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true, httpRoutes: true, commerce: true });
  try {
    enabled.events.length = 0;
    const openapi = await fetch(`${enabled.origin}/openapi.json`);
    const enrich = await fetch(`${enabled.origin}/enrich`);
    const posted = await fetch(`${enabled.origin}/security/wallet-policy-conformance`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment": "dummy-not-a-payment" },
      body: JSON.stringify({ profileId: "synthetic" }),
    });
    assert.equal(openapi.status, 200);
    assert.equal(enrich.status, 402);
    assert.equal(posted.status, 402);
    assert.equal(enabled.events.length, 0);
    await enabled.commerce.flush();
  } finally {
    await enabled.close();
  }
});

test("M18 package and privacy scan excludes assignment fixtures and raw markers", { timeout: 20_000 }, async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-typed-telemetry-producer.mjs"),
    "utf8",
  ));
  assert.equal(/\bres\.write\s*\(/.test(source), false);
  assert.equal(/\bres\.end\s*\(/.test(source), false);
  assert.equal(source.includes("text/event-stream"), false);
  const enabled = await startMounted({ typedEnabled: true });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "privacy.invalid", 180);
    await enabled.drain();
    enabled.events.length = 0;
    await postMcp(enabled.origin, paidCall(181, "enrich", "domain", "privacy.invalid", accepts));
    await enabled.drain();
    const serialized = JSON.stringify(enabled.events);
    for (const marker of [
      "privacy.invalid",
      "x402/payment",
      PAYER,
      PAY_TO,
      "authorization",
      "PAYMENT-SIGNATURE",
      "requestId",
    ]) {
      assert.equal(serialized.includes(marker), false, marker);
    }
  } finally {
    await enabled.close();
  }
});

test("hook-enabled and hook-disabled control-flow receipt stays invariant", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({ typedEnabled: true });
  const disabled = await startMounted({ typedEnabled: false });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 190);
    const { accepts: offAccepts } = await unpaidAccepts(disabled.origin, "enrich", "domain", "example.invalid", 190);
    await enabled.drain();
    enabled.events.length = 0;
    enabled.calls.sequence.length = 0;
    disabled.calls.sequence.length = 0;
    const on = await postMcp(enabled.origin, paidCall(191, "enrich", "domain", "example.invalid", accepts));
    const off = await postMcp(disabled.origin, paidCall(191, "enrich", "domain", "example.invalid", offAccepts));
    await enabled.drain();
    const onReceipt = receiptOf({ ...enabled.capture, status: on.status, headers: on.headers, body: on.body }, enabled.calls, enabled.events);
    const offReceipt = receiptOf({ ...disabled.capture, status: off.status, headers: off.headers, body: off.body }, disabled.calls, disabled.events);
    assert.equal(onReceipt.status, offReceipt.status);
    assert.equal(onReceipt.bodyHash, offReceipt.bodyHash);
    assert.deepEqual(onReceipt.sequence, offReceipt.sequence);
    assert.equal(onReceipt.eventCount, 1);
    assert.equal(offReceipt.eventCount, 0);
  } finally {
    await enabled.close();
    await disabled.close();
  }
});

test("final MCP output-schema failure after settlement is application_failure", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({
    typedEnabled: true,
    streamableHttpOptions: { enableJsonResponse: true },
    tools: [{
      name: "enrich",
      description: "synthetic enrich",
      price: "$0.02",
      inputSchema: { domain: z.string() },
      outputSchema: { ok: z.boolean() },
      run: async () => ({ ok: "wrong-type" }),
    }],
  });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 200);
    await enabled.drain();
    enabled.events.length = 0;
    const on = await postMcp(enabled.origin, paidCall(201, "enrich", "domain", "example.invalid", accepts));
    await enabled.drain();
    assert.equal(on.json?.result?.isError, true);
    assert.equal(enabled.events.length, 1);
    assert.equal(enabled.events[0].result, "application_failure");
    assert.notEqual(enabled.events[0].result, "paid_success");
  } finally {
    await enabled.close();
  }
});

test("SDK input validation before the paid wrapper is not a payment challenge", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({
    typedEnabled: true,
    wrapResponse: false,
    streamableHttpOptions: { enableJsonResponse: true },
  });
  try {
    const invalid = await postMcp(enabled.origin, {
      jsonrpc: "2.0",
      id: 211,
      method: "tools/call",
      params: { name: "enrich", arguments: { domain: 42 } },
    });
    await enabled.drain();
    assert.equal(invalid.json?.result?.isError, true);
    const economic = enabled.events.filter((event) => event?.action === "emit" && ["challenge", "paid_success"].includes(event?.result));
    assert.equal(economic.length, 0);
  } finally {
    await enabled.close();
  }
});

test("synchronous append stall does not delay the HTTP response", { timeout: 20_000 }, async () => {
  const baseline = await startMounted({ typedEnabled: true, wrapResponse: false });
  const delayed = await startMounted({
    typedEnabled: true,
    wrapResponse: false,
    onAppend() {
      const until = performance.now() + 250;
      while (performance.now() < until) { /* reviewer-controlled bounded stall */ }
    },
  });
  try {
    const { accepts } = await unpaidAccepts(baseline.origin, "enrich", "domain", "example.invalid", 220);
    const { accepts: delayedAccepts } = await unpaidAccepts(delayed.origin, "enrich", "domain", "example.invalid", 220);
    await baseline.drain();
    await delayed.drain();
    baseline.events.length = 0;
    delayed.events.length = 0;
    const fast = await postMcp(baseline.origin, paidCall(221, "enrich", "domain", "example.invalid", accepts));
    const slow = await postMcp(delayed.origin, paidCall(221, "enrich", "domain", "example.invalid", delayedAccepts));
    assert.equal(fast.status, slow.status);
    assert.ok(slow.durationMs - fast.durationMs < 100, `append delayed response by ${slow.durationMs - fast.durationMs}ms`);
  } finally {
    await baseline.close();
    await delayed.close();
  }
});

test("typed append uses canonical v4 ledger and production mount has no response observer", { timeout: 20_000 }, async () => {
  const serverSource = await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-server.mjs"),
    "utf8",
  );
  const commerceSource = await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "commerce-events.mjs"),
    "utf8",
  );
  assert.equal(serverSource.includes("typedTelemetry?.observeResponse"), false);
  assert.equal(serverSource.includes("verifyPayment ="), false);
  assert.equal(serverSource.includes("settlePayment ="), false);
  assert.equal(commerceSource.includes("mcp-typed-telemetry.ndjson"), false);
  assert.equal(/captureInProcessObserverArray/.test(serverSource), false);
  assert.equal(serverSource.includes("__typedTelemetryProbe"), false);
  assert.equal(serverSource.includes("typedTelemetryDedupPush"), false);
  assert.equal(serverSource.includes("observerArray"), false);
  assert.equal(serverSource.includes("observerKnown"), false);
  assert.equal(serverSource.includes("rememberObserver"), false);
  assert.equal(serverSource.includes("invokeFirst"), false);
  assert.equal(/Array\.prototype\.push\s*=/.test(serverSource), false);
  assert.equal(/performance\.now\s*=/.test(serverSource), false);
  assert.equal(/Function\.prototype\.toString\.call\(onAppend\)/.test(serverSource), false);
  assert.equal(/Object\.(?:defineProperty|setPrototypeOf)\([^\n]*(?:prototype|globalThis)/.test(serverSource), false);
  assert.equal(/Reflect\.(?:defineProperty|setPrototypeOf)\([^\n]*(?:prototype|globalThis)/.test(serverSource), false);

  const dataDir = await mkdtemp(path.join(os.tmpdir(), "typed-amend1-ledger-"));
  try {
    const commerce = createCommerceTelemetry({ dataDir, secret: "mounted-typed-producer-secret" });
    assert.equal(Object.hasOwn(commerce.paths, "typedMcpPath"), false);
    const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const decision = evaluateMcpTypedTelemetryOutcome({
      schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
      binding: {
        tool: "enrich",
        productSku: "samedaydesk-enrich",
        resource: "mcp://tool/enrich",
        issuedOfferDigest: digest,
      },
      request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
      response: { hasId: true, id: 7, kind: "tool_result" },
      credential: { state: "verified", offerDigest: digest },
      execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
      settlement: { state: "succeeded", offerDigest: digest },
    });
    commerce.appendMcpTypedDecision(decision);
    await commerce.flush();
    const rows = (await readFile(commerce.paths.currentPath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].v, 4);
    assert.equal(rows[0].sourceContract, "mcp_typed_outcome");
    assert.equal(isCanonicalMcpTypedCommerceEvent(rows[0]), true);
    assert.equal(adaptMcpTypedDecisionToCommerceEvent(decision, { id: rows[0].id, ts: rows[0].ts }).result, "paid_success");
    const snapshot = await commerce.snapshot({ days: 90 });
    assert.equal(snapshot.mcpTyped.parseableRecordCount, 1);
    assert.equal(snapshot.mcpTyped.byResult.paid_success, 1);
    assert.equal(snapshot.retainedParseableEventCount, 0);
    assert.equal(snapshot.coverage.integrity.currentFile.unusableRecordCount, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function startCanonicalMounted(options = {}) {
  const calls = { verify: 0, settle: 0, handler: {}, sequence: [], external: 0, loopback: 0 };
  const restoreFetch = installNetworkGuard(calls);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "mcp-typed-canonical-"));
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "mounted-canonical-typed-secret",
    writerProcessCount: 1,
    mcpTypedSince: "2026-01-01T00:00:00.000Z",
    mcpTypedFreshnessMaxAgeMs: 900_000,
  });
  const app = express();
  const mountResult = await mountMcp(app, {
    facilitatorClient: createFacilitator(calls, options.facilitator),
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "typed-producer-canonical", version: "1" },
    streamableHttpOptions: { enableJsonResponse: true },
    tools: [{
      name: "enrich",
      description: "synthetic enrich",
      price: "$0.02",
      inputSchema: { domain: z.string() },
      run: async () => ({ ok: true }),
    }],
    typedTelemetry: {
      enabled: true,
      onAppend: (decision) => telemetry.appendMcpTypedDecision(decision),
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    calls,
    telemetry,
    mountResult,
    async drain() {
      await mountResult.typedTelemetryLifecycle.flush({ timeoutMs: 1_000 });
    },
    async close() {
      restoreFetch();
      await closeServer(server);
      await mountResult.typedTelemetryLifecycle.shutdown({ timeoutMs: 250 }).catch(() => {});
      await telemetry.flush();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("M01 unpaid absent-credential challenge persists on the canonical ledger", { timeout: 20_000 }, async () => {
  const instance = await startCanonicalMounted();
  try {
    const unpaid = await postMcp(instance.origin, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "enrich", arguments: { domain: "example.invalid" } },
    });
    assert.equal(unpaid.status, 200);
    await instance.drain();
    const rows = (await readFile(instance.telemetry.paths.currentPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    const challenge = rows.find((row) => (
      row.sourceContract === "mcp_typed_outcome"
      && row.result === "challenge"
      && row.paymentPresent === false
      && row.paymentCredentialParsed === false
    ));
    assert.ok(challenge, "absent credential challenge was not persisted");
    assert.equal(isCanonicalMcpTypedCommerceEvent(challenge), true);
    const snapshot = await instance.telemetry.snapshot({ days: 30 });
    assert.equal(snapshot.mcpTyped.byResult.challenge, 1);
  } finally {
    await instance.close();
  }
});

test("M05 rejected-credential challenge persists on the canonical ledger", { timeout: 20_000 }, async () => {
  const instance = await startCanonicalMounted({
    facilitator: { verify: () => ({ isValid: false, invalidReason: "synthetic-reject" }) },
  });
  try {
    const { unpaid, accepts } = await unpaidAccepts(instance.origin, "enrich", "domain", "example.invalid", 21);
    assert.equal(unpaid.status, 200);
    await instance.drain();
    const rejected = await postMcp(instance.origin, paidCall(22, "enrich", "domain", "example.invalid", accepts));
    assert.equal(rejected.status, 200);
    await instance.drain();
    const rows = (await readFile(instance.telemetry.paths.currentPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    const challenge = rows.find((row) => (
      row.sourceContract === "mcp_typed_outcome"
      && row.result === "challenge"
      && row.paymentPresent === true
      && row.paymentCredentialParsed === false
    ));
    assert.ok(challenge, "rejected credential challenge was not persisted");
    assert.equal(isCanonicalMcpTypedCommerceEvent(challenge), true);
    const snapshot = await instance.telemetry.snapshot({ days: 30 });
    assert.ok((snapshot.mcpTyped.byResult.challenge || 0) >= 1);
  } finally {
    await instance.close();
  }
});

test("first callback is detached from the request stack", { timeout: 20_000 }, async () => {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  let callbackCount = 0;
  let globalMutationObserved = false;
  const delayed = await startMounted({
    typedEnabled: true,
    wrapResponse: false,
    onAppend() {
      callbackCount += 1;
      const current = Object.getOwnPropertyDescriptor(Array.prototype, "push");
      globalMutationObserved ||= current?.value !== original?.value;
      const until = performance.now() + 220;
      while (performance.now() < until) { /* reviewer-controlled bounded stall */ }
    },
  });
  const baseline = await startMounted({ typedEnabled: false, wrapResponse: false });
  try {
    const on = await postMcp(delayed.origin, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "enrich", arguments: { domain: "example.invalid" } },
    });
    const off = await postMcp(baseline.origin, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "enrich", arguments: { domain: "example.invalid" } },
    });
    assert.equal(on.status, off.status);
    assert.ok(on.durationMs < 150, `first callback delayed response: ${on.durationMs}ms`);
    assert.equal(globalMutationObserved, false);
    await delayed.drain();
    assert.equal(callbackCount, 1);
  } finally {
    await delayed.close();
    await baseline.close();
  }
});

test("lifecycle does not mutate Array.prototype during a callback", { timeout: 20_000 }, async () => {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  let globalMutationObserved = false;
  const enabled = await startMounted({
    typedEnabled: true,
    wrapResponse: false,
    onAppend() {
      const current = Object.getOwnPropertyDescriptor(Array.prototype, "push");
      globalMutationObserved ||= current?.value !== original?.value;
    },
  });
  try {
    await postMcp(enabled.origin, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "enrich", arguments: { domain: "example.invalid" } },
    });
    await enabled.drain();
    assert.equal(globalMutationObserved, false);
    const after = Object.getOwnPropertyDescriptor(Array.prototype, "push");
    assert.equal(after?.value, original?.value);
  } finally {
    await enabled.close();
  }
});

test("callback data stays isolated from lifecycle-owned queue", { timeout: 20_000 }, async () => {
  const observed = [];
  let callbacks = 0;
  let secondWasPrepopulated = false;
  const enabled = await startMounted({
    typedEnabled: true,
    wrapResponse: false,
    onAppend(decision) {
      callbacks += 1;
      if (callbacks === 2) secondWasPrepopulated = observed.includes(decision);
      observed.push(decision);
    },
  });
  try {
    await postMcp(enabled.origin, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "enrich", arguments: { domain: "example.invalid" } },
    });
    await postMcp(enabled.origin, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "enrich", arguments: { domain: "example.invalid" } },
    });
    await enabled.drain();
    assert.equal(secondWasPrepopulated, false);
    assert.equal(observed.length, 2);
    assert.equal(callbacks, 2);
  } finally {
    await enabled.close();
  }
});

test("hostile then-getter callback result is one contained append failure", { timeout: 20_000 }, async () => {
  const enabled = await startMounted({
    typedEnabled: true,
    onAppend(decision) {
      if (decision?.result !== "paid_success") return undefined;
      return Object.defineProperty({}, "then", {
        get() { throw new Error("hostile-then-getter-secret"); },
      });
    },
  });
  const disabled = await startMounted({ typedEnabled: false });
  try {
    const { accepts } = await unpaidAccepts(enabled.origin, "enrich", "domain", "example.invalid", 240);
    const { accepts: offAccepts } = await unpaidAccepts(disabled.origin, "enrich", "domain", "example.invalid", 240);
    await enabled.drain();
    enabled.events.length = 0;
    const on = await postMcp(enabled.origin, paidCall(241, "enrich", "domain", "example.invalid", accepts));
    const off = await postMcp(disabled.origin, paidCall(241, "enrich", "domain", "example.invalid", offAccepts));
    const state = await enabled.drain();
    assert.equal(on.status, off.status);
    assert.equal(sha256(on.body), sha256(off.body));
    assert.equal(state.drained, true);
    assert.equal(state.pending, 0);
    assert.equal(state.failures, 1);
    assert.equal(JSON.stringify(enabled.events).includes("hostile-then-getter-secret"), false);
    const again = await enabled.drain();
    assert.deepEqual(again, { drained: true, pending: 0, failures: 1 });
  } finally {
    await enabled.close();
    await disabled.close();
  }
});
