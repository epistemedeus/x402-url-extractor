import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyHttpTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as ModernClient, SdkError } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport as ModernHttpTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import { toWebRequest } from "@modelcontextprotocol/node";
import { createIdempotencyReplay } from "../../idempotency-replay.mjs";
import { injectPaymentSignatureHeader, mountMcp, withholdExplicitFalseSettlement } from "../../mcp-server.mjs";

const NETWORK = "eip155:84532";
const PAY_TO = `0x${"22".repeat(20)}`;
const PAYER = `0x${"11".repeat(20)}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function tools(calls) {
  return [
    {
      name: "local_note",
      free: true,
      description: "Useful local note. charged is false.",
      price: "$0",
      inputSchema: { note: z.string().min(1).max(40) },
      outputSchema: z.object({
        ok: z.literal(true),
        note: z.string().min(1),
        charged: z.literal(false),
      }).strict(),
      run: async (args) => ({ ok: true, note: args.note, charged: false }),
    },
    {
      name: "enrich",
      description: "Synthetic priced note. The same handler serves every protocol era.",
      price: "$0.01",
      inputSchema: { note: z.string().min(1).max(40) },
      outputSchema: z.object({
        ok: z.literal(true),
        note: z.string().min(1),
      }).strict(),
      run: async (args) => {
        calls.handler += 1;
        calls.sequence.push("handler");
        return { ok: true, note: args.note };
      },
    },
  ];
}

function facilitatorFor(calls, policy = {}) {
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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function startMerchant(t, { modern = true, policy = {}, recovery = false, typed = false } = {}) {
  const calls = { verify: 0, settle: 0, handler: 0, sequence: [] };
  const events = [];
  const app = express();
  let dataDir = null;
  let nativeRecovery = null;
  if (recovery) {
    dataDir = await mkdtemp(path.join(tmpdir(), "oct29-merchant-"));
    nativeRecovery = {
      journal: createIdempotencyReplay({ dataDir, secret: "oct29-synthetic-replay" }),
      endpointUrl: "http://127.0.0.1:9/mcp",
      tenantId: "public",
    };
  }
  const mount = await mountMcp(app, {
    facilitatorClient: facilitatorFor(calls, policy),
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "merchant-modern-test", version: "1.23.55" },
    modernProtocol: modern,
    tools: tools(calls),
    ...(nativeRecovery ? { nativeRecovery } : {}),
    ...(typed ? {
      typedTelemetry: {
        enabled: true,
        onAppend: (decision) => { events.push(decision); },
      },
    } : {}),
  });
  const server = app.listen(0, "127.0.0.1");
  const port = await new Promise((resolve, reject) => {
    server.once("listening", () => resolve(server.address().port));
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await closeServer(server);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });
  return { origin, calls, mount, events };
}

function challengeOf(result) {
  assert.equal(result.isError, true);
  const text = result.content?.[0]?.text;
  assert.equal(typeof text, "string");
  const parsed = JSON.parse(text);
  assert.equal(parsed.x402Version, 2);
  assert.ok(Array.isArray(parsed.accepts) && parsed.accepts.length > 0);
  assert.equal(parsed.accepts[0].payTo, PAY_TO);
  return parsed;
}

function paymentFor(name, accepted, nonce = randomBytes(32).toString("hex")) {
  return {
    x402Version: 2,
    resource: { url: `mcp://tool/${name}` },
    accepted,
    payload: {
      signature: `0x${"ab".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${nonce}`,
      },
    },
  };
}

async function postRpc(origin, body, headers = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    const data = text.split("\n").map((line) => line.trim()).find((line) => line.startsWith("data:"));
    if (data) json = JSON.parse(data.slice(5).trim());
  }
  return { status: response.status, text, json };
}

function envelope(version, capabilities = {}) {
  return {
    [PROTOCOL_VERSION_META_KEY]: version,
    [CLIENT_CAPABILITIES_META_KEY]: capabilities,
    [CLIENT_INFO_META_KEY]: { name: "raw-client", version: "0.0.1" },
  };
}

async function connectLegacy(origin, clientName = "legacy-caller") {
  const client = new LegacyClient({ name: clientName, version: "2025.1" });
  const transport = new LegacyHttpTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  return { client, transport };
}

async function connectModern(origin, mode, clientName = "modern-caller") {
  const client = new ModernClient({ name: clientName, version: "9.9.9" }, {
    versionNegotiation: { mode },
  });
  const transport = new ModernHttpTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  return { client, transport };
}

test("production mount opts into 2026-07-28 without replacing the legacy handler", () => {
  const source = readFileSync(path.join(root, "server.js"), "utf8");
  const mcp = readFileSync(path.join(root, "mcp-server.mjs"), "utf8");
  assert.match(source, /modernProtocol:\s*true/);
  assert.match(source, /payTo:\s*PAY_TO/);
  assert.match(source, /network:\s*NETWORK/);
  assert.match(mcp, /cfg\.modernProtocol === true/);
  assert.match(mcp, /legacy:\s*"reject"/);
  assert.match(mcp, /isLegacyRequest/);
  assert.equal(mcp.includes("createPaymentWrapper"), true);
});

test("payment header injection does not create a modern envelope claim", async () => {
  const body = {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "enrich", arguments: { note: "header" } },
  };
  const payment = {
    x402Version: 2,
    payload: { authorization: { from: PAYER }, signature: "0xabc" },
  };
  const req = {
    method: "POST",
    url: "/mcp",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body,
    get(name) {
      return name === "PAYMENT-SIGNATURE" ? Buffer.from(JSON.stringify(payment)).toString("base64") : undefined;
    },
  };
  assert.equal(injectPaymentSignatureHeader(req), true);
  assert.equal(req.body.params._meta["x402/payment"].x402Version, 2);
  assert.equal(PROTOCOL_VERSION_META_KEY in req.body.params._meta, false);
  const web = await toWebRequest(req, req.body);
  assert.equal(await isLegacyRequest(web, req.body), true);
});

test("legacy, automatic, and pinned clients share one merchant on the modern opt-in", async (t) => {
  const merchant = await startMerchant(t, { modern: true });
  assert.equal(merchant.mount.modernProtocol, "2026-07-28");

  const legacy = await connectLegacy(merchant.origin);
  t.after(() => legacy.client.close());
  assert.equal(legacy.transport.protocolVersion, "2025-11-25");
  const legacyTools = await legacy.client.listTools();
  assert.ok(legacyTools.tools.some((tool) => tool.name === "local_note"));
  assert.equal(legacyTools.tools.find((tool) => tool.name === "enrich")._meta.x402.paymentRequired, true);
  const legacyFree = await legacy.client.callTool({ name: "local_note", arguments: { note: "legacy-free" } });
  assert.equal(legacyFree.isError, undefined);
  assert.deepEqual(legacyFree.structuredContent, { ok: true, note: "legacy-free", charged: false });
  const legacyChallenge = challengeOf(await legacy.client.callTool({ name: "enrich", arguments: { note: "legacy-paid" } }));
  assert.equal(merchant.calls.handler, 0);
  assert.equal(merchant.calls.verify, 0);
  assert.equal(legacyChallenge.accepts[0].network, NETWORK);

  const automatic = await connectModern(merchant.origin, "auto", "auto-caller");
  t.after(() => automatic.client.close());
  assert.equal(automatic.client.getNegotiatedProtocolVersion(), "2026-07-28");
  assert.deepEqual(automatic.client.getServerVersion(), { name: "merchant-modern-test", version: "1.23.55" });
  assert.notEqual(automatic.client.getServerVersion().name, "auto-caller");
  const modernFree = await automatic.client.callTool({ name: "local_note", arguments: { note: "modern-free" } });
  assert.deepEqual(modernFree.structuredContent, { ok: true, note: "modern-free", charged: false });
  challengeOf(await automatic.client.callTool({ name: "enrich", arguments: { note: "modern-paid" } }));
  assert.equal(merchant.calls.handler, 0);

  const pinned = await connectModern(merchant.origin, { pin: "2026-07-28" }, "pinned-caller");
  t.after(() => pinned.client.close());
  assert.equal(pinned.client.getNegotiatedProtocolVersion(), "2026-07-28");
  const listed = await pinned.client.listTools();
  const priced = listed.tools.find((tool) => tool.name === "enrich");
  assert.equal(priced.inputSchema.type, "object");
  assert.equal(priced.inputSchema.properties.note.type, "string");
  const rejectedNote = await pinned.client.callTool({ name: "local_note", arguments: { note: "" } });
  assert.equal(rejectedNote.isError, true);
  assert.match(rejectedNote.content[0].text, /Invalid|Too small|expected string/i);
});

test("legacy default keeps old callers and rejects an explicit modern pin", async (t) => {
  const merchant = await startMerchant(t, { modern: false });
  assert.equal(merchant.mount.modernProtocol, false);
  const legacy = await connectLegacy(merchant.origin, "old-caller");
  t.after(() => legacy.client.close());
  assert.equal(legacy.transport.protocolVersion, "2025-11-25");
  const free = await legacy.client.callTool({ name: "local_note", arguments: { note: "old" } });
  assert.equal(free.structuredContent.charged, false);
  challengeOf(await legacy.client.callTool({ name: "enrich", arguments: { note: "old-paid" } }));

  const automatic = await connectModern(merchant.origin, "auto");
  t.after(() => automatic.client.close());
  assert.equal(automatic.client.getNegotiatedProtocolVersion(), "2025-11-25");
  const fallback = await automatic.client.callTool({ name: "local_note", arguments: { note: "fallback" } });
  assert.equal(fallback.structuredContent.note, "fallback");

  const pinned = new ModernClient({ name: "pin-fail", version: "1" }, {
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  });
  await assert.rejects(
    pinned.connect(new ModernHttpTransport(new URL(`${merchant.origin}/mcp`))),
    (error) => error instanceof SdkError && error.code === "ERA_NEGOTIATION_FAILED",
  );
});

test("unsupported era, malformed metadata, and identity confusion stay on the modern path", async (t) => {
  const merchant = await startMerchant(t, { modern: true });
  const unsupported = await postRpc(merchant.origin, {
    jsonrpc: "2.0",
    id: 11,
    method: "tools/list",
    params: { _meta: envelope("1999-01-01") },
  });
  assert.equal(unsupported.json.id, 11);
  assert.equal(typeof unsupported.json.error.code, "number");
  assert.notEqual(unsupported.json.error.code, -32603);
  assert.match(JSON.stringify(unsupported.json.error), /1999-01-01|Unsupported protocol version|protocol version/i);

  const malformed = await postRpc(merchant.origin, {
    jsonrpc: "2.0",
    id: 12,
    method: "tools/list",
    params: { _meta: envelope("2026-07-28", "not-capabilities") },
  });
  assert.equal(malformed.json.error.code, -32602);

  const mismatch = await postRpc(merchant.origin, {
    jsonrpc: "2.0",
    id: "2026-07-28",
    method: "tools/call",
    params: {
      name: "enrich",
      arguments: { note: "confused" },
      _meta: envelope("2026-07-28"),
    },
  }, { "mcp-protocol-version": "2025-11-25" });
  assert.equal(mismatch.json.id, "2026-07-28");
  assert.equal(mismatch.json.error.code, -32020);
  assert.equal(merchant.calls.verify, 0);
  assert.equal(merchant.calls.handler, 0);

  const identified = await postRpc(merchant.origin, {
    jsonrpc: "2.0",
    id: "2026-07-28",
    method: "tools/call",
    params: {
      name: "enrich",
      arguments: { note: "confused" },
      _meta: envelope("2026-07-28"),
    },
  }, {
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
    "mcp-name": "enrich",
  });
  if (!identified.json?.result?.isError) {
    throw new Error(`identity response ${identified.status} ${identified.text.slice(0, 1800)}`);
  }
  const body = identified.json.result;
  assert.equal(identified.json.id, "2026-07-28");
  assert.equal(body.isError, true);
  const serverInfo = body._meta?.["io.modelcontextprotocol/serverInfo"];
  assert.equal(serverInfo.name, "merchant-modern-test");
  assert.notEqual(serverInfo.name, "raw-client");
  assert.notEqual(serverInfo.version, "2026-07-28");
  const challenge = JSON.parse(body.content[0].text);
  assert.equal(challenge.x402Version, 2);
  assert.notEqual(challenge.accepts[0].payTo, "2026-07-28");

  const missing = await postRpc(merchant.origin, {
    jsonrpc: "2.0",
    id: 13,
    method: "tools/call",
    params: { name: "not_a_tool", arguments: {} },
  });
  assert.equal(missing.json.error.code, -32602);
  const missingModern = await postRpc(merchant.origin, {
    jsonrpc: "2.0",
    id: 14,
    method: "tools/call",
    params: { name: "not_a_tool", arguments: {}, _meta: envelope("2026-07-28") },
  });
  assert.equal(missingModern.json.error.code, -32602);

  const method = await fetch(`${merchant.origin}/mcp`);
  assert.equal(method.status, 405);
});

test("failed verify and settlement refusal do not invent a second payment", async (t) => {
  const invalid = await startMerchant(t, {
    policy: { verify: () => ({ isValid: false, invalidReason: "synthetic_reject" }) },
  });
  const client = await connectModern(invalid.origin, { pin: "2026-07-28" });
  t.after(() => client.client.close());
  const listed = await client.client.listTools();
  const accepted = listed.tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
  const payment = paymentFor("enrich", accepted);
  const rejected = await client.client.callTool({
    name: "enrich",
    arguments: { note: "reject" },
    _meta: { "x402/payment": payment },
  });
  challengeOf(rejected);
  assert.deepEqual(
    { verify: invalid.calls.verify, settle: invalid.calls.settle, handler: invalid.calls.handler },
    { verify: 1, settle: 0, handler: 0 },
  );

  const refused = await startMerchant(t, {
    policy: { settle: () => { throw new Error("settlement_refused"); } },
  });
  const payer = await connectModern(refused.origin, { pin: "2026-07-28" }, "settle-caller");
  t.after(() => payer.client.close());
  const accepts = (await payer.client.listTools()).tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
  const settled = await payer.client.callTool({
    name: "enrich",
    arguments: { note: "refuse" },
    _meta: { "x402/payment": paymentFor("enrich", accepts) },
  });
  assert.equal(settled.isError, true);
  assert.equal(settled.structuredContent?.note, undefined);
  assert.equal(settled._meta?.["x402/payment-response"]?.success, undefined);
  assert.equal(settled.content[0].text.includes("\"note\":\"refuse\""), false);
  assert.deepEqual(
    { verify: refused.calls.verify, settle: refused.calls.settle, handler: refused.calls.handler },
    { verify: 1, settle: 1, handler: 1 },
  );
});

test("direct shared boundary withholds only an explicit false settlement", () => {
  const paid = {
    content: [{ type: "text", text: JSON.stringify({ ok: true, note: "secret-table", markdown: "<table>Engine</table>" }) }],
    structuredContent: { ok: true, note: "secret-table" },
    _meta: {
      "x402/payment-response": {
        success: false,
        transaction: `0x${"44".repeat(32)}`,
        errorReason: "synthetic_settle_false",
        payer: PAYER,
      },
      "samedaydesk/caller-receipt": { success: true },
    },
  };
  const withheld = withholdExplicitFalseSettlement(paid);
  assert.equal(withheld.isError, true);
  assert.equal(JSON.stringify(withheld).includes("secret-table"), false);
  assert.equal(JSON.stringify(withheld).includes("Engine"), false);
  assert.equal(JSON.stringify(withheld).includes(PAYER), false);
  assert.equal(withheld._meta["x402/payment-response"].success, false);
  assert.equal(withheld._meta["x402/payment-response"].transaction, undefined);
  assert.equal(withheld._meta["samedaydesk/caller-receipt"], undefined);
  assert.equal(JSON.parse(withheld.content[0].text).error, "settlement_unsuccessful");
  assert.equal(JSON.parse(withheld.content[0].text).charged, undefined);

  const settled = {
    content: [{ type: "text", text: "kept-note" }],
    structuredContent: { ok: true, note: "kept-note" },
    _meta: { "x402/payment-response": { success: true, transaction: `0x${"33".repeat(32)}` } },
  };
  assert.equal(withholdExplicitFalseSettlement(settled), settled);

  const ambiguous = {
    content: [{ type: "text", text: "ambiguous-body" }],
    _meta: { "x402/payment-response": { transaction: "", network: NETWORK } },
  };
  assert.equal(withholdExplicitFalseSettlement(ambiguous), ambiguous);
  const worded = {
    content: [{ type: "text", text: "worded-body" }],
    _meta: { "x402/payment-response": { success: "false" } },
  };
  assert.equal(withholdExplicitFalseSettlement(worded), worded);

  const thrown = { isError: true, content: [{ type: "text", text: "Payment settlement failed: boom" }] };
  assert.equal(withholdExplicitFalseSettlement(thrown), thrown);
  const handlerError = {
    isError: true,
    content: [{ type: "text", text: "handler-said" }],
    _meta: { "x402/payment-response": { success: false } },
  };
  assert.equal(withholdExplicitFalseSettlement(handlerError), handlerError);
});

function assertFalseSettlementWithheld(result, secret) {
  assert.equal(result.isError, true);
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes("<table"), false);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.ok, false);
  assert.equal(body.error, "settlement_unsuccessful");
  assert.equal(body.settlementSuccess, false);
  assert.equal(body.charged, undefined);
  assert.equal(result.structuredContent, undefined);
  assert.equal(result._meta["x402/payment-response"].success, false);
  assert.equal(result._meta["x402/payment-response"].transaction, undefined);
  assert.notEqual(result._meta["x402/payment-response"].success, true);
}

test("explicit false settlement withholds paid output on modern and legacy mounts", async (t) => {
  for (const modern of [true, false]) {
    const merchant = await startMerchant(t, {
      modern,
      typed: true,
      policy: {
        settle: () => ({
          success: false,
          errorReason: "synthetic_settle_false",
          transaction: `0x${"44".repeat(32)}`,
          network: NETWORK,
        }),
      },
    });
    const connected = modern
      ? await connectModern(merchant.origin, { pin: "2026-07-28" }, "false-modern")
      : await connectLegacy(merchant.origin, "false-legacy");
    t.after(() => connected.client.close());
    const accepted = (await connected.client.listTools()).tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
    const secret = modern ? "modern-paid-secret" : "legacy-paid-secret";
    const result = await connected.client.callTool({
      name: "enrich",
      arguments: { note: secret },
      _meta: {
        "x402/payment": paymentFor("enrich", accepted),
        "x402/payment-response": { success: true, transaction: `0x${"55".repeat(32)}` },
      },
    });
    assertFalseSettlementWithheld(result, secret);
    assert.deepEqual(merchant.calls.sequence, ["verify", "handler", "settle"]);
    assert.deepEqual(
      { verify: merchant.calls.verify, settle: merchant.calls.settle, handler: merchant.calls.handler },
      { verify: 1, settle: 1, handler: 1 },
    );
    await merchant.mount.typedTelemetryLifecycle.flush({ timeoutMs: 1000 });
    assert.equal(merchant.events.length, 1);
    assert.equal(merchant.events[0].result, "settlement_failure");
    assert.equal(merchant.events[0].reason, "typed_settlement_failure");
    assert.equal(merchant.events[0].handlerInvoked, true);
    assert.equal(merchant.events[0].applicationOutcome, "success");
    assert.equal(merchant.events[0].settlementState, "failed");
    assert.notEqual(merchant.events[0].result, "paid_success");
    assert.equal(JSON.stringify(merchant.events[0]).includes(secret), false);
  }
});

test("ambiguous settlement stays unknown and a false settlement is not recoverable", async (t) => {
  const ambiguous = await startMerchant(t, {
    modern: true,
    typed: true,
    policy: { settle: () => ({ transaction: "", network: NETWORK }) },
  });
  const modernClient = await connectModern(ambiguous.origin, { pin: "2026-07-28" }, "unknown-modern");
  t.after(() => modernClient.client.close());
  const modernAccepted = (await modernClient.client.listTools()).tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
  const unknownResult = await modernClient.client.callTool({
    name: "enrich",
    arguments: { note: "ambiguous-note" },
    _meta: { "x402/payment": paymentFor("enrich", modernAccepted) },
  });
  assert.notEqual(unknownResult._meta?.["x402/payment-response"]?.success, true);
  assert.equal(JSON.parse(unknownResult.content?.[0]?.text || "{}").error, undefined);
  await ambiguous.mount.typedTelemetryLifecycle.flush({ timeoutMs: 1000 });
  assert.equal(ambiguous.events[0].result, "telemetry_incomplete");
  assert.equal(ambiguous.events[0].settlementState, "unknown");
  assert.notEqual(ambiguous.events[0].result, "paid_success");

  const legacyUnknown = await startMerchant(t, {
    modern: false,
    typed: true,
    policy: { settle: () => ({ transaction: "", network: NETWORK }) },
  });
  const legacyClient = await connectLegacy(legacyUnknown.origin, "unknown-legacy");
  t.after(() => legacyClient.client.close());
  const legacyAccepted = (await legacyClient.client.listTools()).tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
  await legacyClient.client.callTool({
    name: "enrich",
    arguments: { note: "ambiguous-legacy" },
    _meta: { "x402/payment": paymentFor("enrich", legacyAccepted) },
  });
  await legacyUnknown.mount.typedTelemetryLifecycle.flush({ timeoutMs: 1000 });
  assert.equal(legacyUnknown.events[0].settlementState, "unknown");
  assert.notEqual(legacyUnknown.events[0].result, "paid_success");

  for (const modern of [true, false]) {
    const merchant = await startMerchant(t, {
      modern,
      recovery: true,
      policy: { settle: () => ({ success: false, errorReason: "synthetic_settle_false", transaction: "", network: NETWORK }) },
    });
    const connected = modern
      ? await connectModern(merchant.origin, { pin: "2026-07-28" }, "recover-false-modern")
      : await connectLegacy(merchant.origin, "recover-false-legacy");
    t.after(() => connected.client.close());
    const accepted = (await connected.client.listTools()).tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
    const payment = paymentFor("enrich", accepted);
    const secret = modern ? "recover-modern-secret" : "recover-legacy-secret";
    const first = await connected.client.callTool({
      name: "enrich",
      arguments: { note: secret },
      _meta: { "x402/payment": payment },
    });
    assertFalseSettlementWithheld(first, secret);
    const replay = await connected.client.callTool({
      name: "enrich",
      arguments: { note: secret },
      _meta: { "x402/payment": payment },
    });
    assert.equal(JSON.stringify(replay).includes(secret), false);
    assert.equal(merchant.calls.handler, 1);
    assert.equal(merchant.calls.settle, 1);
    const conflict = await connected.client.callTool({
      name: "enrich",
      arguments: { note: "changed-args" },
      _meta: { "x402/payment": payment },
    });
    assert.equal(conflict.isError, true);
    assert.equal(JSON.stringify(conflict).includes(secret), false);
    assert.equal(merchant.calls.handler, 1);
    const recovered = await connected.client.callTool({
      name: "recover_paid_result",
      arguments: { name: "enrich", arguments: { note: secret } },
      _meta: { "x402/payment": payment },
    });
    assert.equal(recovered.isError, true);
    assert.equal(JSON.stringify(recovered).includes(secret), false);
    assert.notEqual(recovered.structuredContent?.note, secret);
    const fresh = paymentFor("enrich", accepted);
    const again = await connected.client.callTool({
      name: "enrich",
      arguments: { note: "fresh-false" },
      _meta: { "x402/payment": fresh },
    });
    assertFalseSettlementWithheld(again, "fresh-false");
    assert.notEqual(fresh.payload.authorization.nonce, payment.payload.authorization.nonce);
    assert.deepEqual(
      { verify: merchant.calls.verify, settle: merchant.calls.settle, handler: merchant.calls.handler },
      { verify: 2, settle: 2, handler: 2 },
    );
  }
});

function runPython(args) {
  const python = process.env.H64201_PYTHON || "python3";
  const script = path.join(root, "experiments/oct29-merchant-compatibility/python-false-settlement.py");
  const pythonPath = [process.env.H64201_PYTHONPATH, "/tmp/oct29-mcp-py-site", process.env.PYTHONPATH]
    .filter(Boolean)
    .join(":");
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, ...args], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: pythonPath },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`python client exit ${code}: ${stderr.slice(-800)} ${stdout.slice(-400)}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test("python client sees withheld false settlement on both mounts", async (t) => {
  for (const [modern, mode] of [[true, "pin"], [false, "legacy"]]) {
    const merchant = await startMerchant(t, {
      modern,
      policy: { settle: () => ({ success: false, errorReason: "synthetic_settle_false", transaction: "", network: NETWORK }) },
    });
    const connected = modern
      ? await connectModern(merchant.origin, { pin: "2026-07-28" })
      : await connectLegacy(merchant.origin);
    t.after(() => connected.client.close());
    const accepted = (await connected.client.listTools()).tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
    const payment = paymentFor("enrich", accepted);
    const secret = modern ? "py-modern-secret" : "py-legacy-secret";
    const report = await runPython([
      "--url", `${merchant.origin}/mcp`,
      "--mode", mode,
      "--note", secret,
      "--meta", JSON.stringify({
        "x402/payment": payment,
        "x402/payment-response": { success: true, transaction: `0x${"66".repeat(32)}` },
      }),
    ]);
    assert.equal(report.error, null);
    assert.equal(report.isError, true);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(report.parsed.error, "settlement_unsuccessful");
    assert.equal(report.parsed.settlementSuccess, false);
    assert.equal(report.paymentSuccess, false);
    assert.deepEqual(
      { verify: merchant.calls.verify, settle: merchant.calls.settle, handler: merchant.calls.handler },
      { verify: 1, settle: 1, handler: 1 },
    );
  }
});

test("lost response recovers the same operation and a new nonce is a new operation", async (t) => {
  const merchant = await startMerchant(t, { recovery: true });
  const proxyState = { loseNextPaid: true, lost: 0 };
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const message = raw.length ? JSON.parse(raw.toString("utf8")) : null;
      const headers = { ...req.headers };
      delete headers.host;
      delete headers["content-length"];
      const response = await fetch(`${merchant.origin}${req.url}`, {
        method: req.method,
        headers,
        body: raw.length ? raw : undefined,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const paid = message?.method === "tools/call"
        && message.params?.name === "enrich"
        && message.params?._meta?.["x402/payment"];
      if (proxyState.loseNextPaid && paid) {
        proxyState.loseNextPaid = false;
        proxyState.lost += 1;
        res.destroy();
        return;
      }
      const forwarded = {};
      for (const [name, value] of response.headers) {
        if (name === "content-length" || name === "transfer-encoding") continue;
        forwarded[name] = value;
      }
      res.writeHead(response.status, forwarded);
      res.end(bytes);
    } catch {
      res.destroy();
    }
  });
  const proxyPort = await listen(proxy);
  t.after(() => closeServer(proxy));
  const client = await connectModern(`http://127.0.0.1:${proxyPort}`, { pin: "2026-07-28" }, "recovery-caller");
  t.after(() => client.client.close());
  const accepted = (await client.client.listTools()).tools.find((tool) => tool.name === "enrich")._meta.x402.accepts[0];
  const payment = paymentFor("enrich", accepted);
  await assert.rejects(client.client.callTool({
    name: "enrich",
    arguments: { note: "kept" },
    _meta: { "x402/payment": payment },
  }));
  assert.equal(proxyState.lost, 1);
  assert.deepEqual(
    { verify: merchant.calls.verify, settle: merchant.calls.settle, handler: merchant.calls.handler },
    { verify: 1, settle: 1, handler: 1 },
  );

  const recovered = await client.client.callTool({
    name: "recover_paid_result",
    arguments: { name: "enrich", arguments: { note: "kept" } },
    _meta: { "x402/payment": payment },
  });
  assert.equal(recovered.isError, undefined);
  assert.equal(recovered.structuredContent.note, "kept");
  assert.deepEqual(
    { verify: merchant.calls.verify, settle: merchant.calls.settle, handler: merchant.calls.handler },
    { verify: 1, settle: 1, handler: 1 },
  );

  const fresh = paymentFor("enrich", accepted);
  const again = await client.client.callTool({
    name: "enrich",
    arguments: { note: "fresh" },
    _meta: { "x402/payment": fresh },
  });
  assert.equal(again.structuredContent.note, "fresh");
  assert.notEqual(fresh.payload.authorization.nonce, payment.payload.authorization.nonce);
  assert.deepEqual(
    { verify: merchant.calls.verify, settle: merchant.calls.settle, handler: merchant.calls.handler },
    { verify: 2, settle: 2, handler: 2 },
  );
});

test("explicit stdio opt-in discovers, calls the free tool, and challenges the paid tool", async (t) => {
  const script = path.join(root, "experiments/oct29-merchant-compatibility/stdio-merchant.mjs");
  const client = new ModernClient({ name: "stdio-pin", version: "1" }, {
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    cwd: root,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    await client.close().catch(() => {});
  });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`${error.message}\n${stderr.slice(-2000)}`);
  }
  assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
  assert.equal(client.getServerVersion().name, "stdio-merchant");
  const listed = await client.listTools();
  assert.ok(listed.tools.some((tool) => tool.name === "local_note"));
  const free = await client.callTool({ name: "local_note", arguments: { note: "stdio" } });
  assert.deepEqual(free.structuredContent, { ok: true, note: "stdio", charged: false });
  const challenge = JSON.parse((await client.callTool({
    name: "enrich",
    arguments: { note: "stdio-paid" },
  })).content[0].text);
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.accepts[0].payTo, PAY_TO);
});
