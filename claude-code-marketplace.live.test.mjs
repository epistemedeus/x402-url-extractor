import assert from "node:assert/strict";
import test from "node:test";

import { assertExtractDiscoveryInventory } from "./extract-discovery-inventory.mjs";

const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const LIVE_EXTRACT_URL = "https://agents.samedaydesk.com/extract";
const SOURCE_HEADER = "X-SameDayDesk-Agent-Source";
const CLAIMED_SOURCE_VALUE = "claude-code-marketplace-v1";
const TEST_USER_AGENT = "SameDayDesk-C25-claude-marketplace/0.1.1";
const MCP_PROTOCOL = "2025-11-25";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_000_000;

function parseSseOrJson(text, label) {
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON or JSON SSE data`);
  }
  return payload;
}

async function postRpc(method, params, id, extraHeaders = {}) {
  const response = await fetch(LIVE_MCP_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "user-agent": TEST_USER_AGENT,
      [SOURCE_HEADER]: CLAIMED_SOURCE_VALUE,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_BYTES, `${method} response too large`);
  let payload = null;
  try {
    payload = parseSseOrJson(text, method);
  } catch {
    payload = { parseError: true, textPreview: text.slice(0, 500) };
  }
  return { response, text, payload };
}

test("unpaid HTTP extract returns live 402; amount is read, not authorized", async () => {
  const url = `${LIVE_EXTRACT_URL}?url=${encodeURIComponent("https://example.com")}`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "user-agent": TEST_USER_AGENT,
      [SOURCE_HEADER]: CLAIMED_SOURCE_VALUE,
    },
  });
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.error, "Payment required");
  assert.equal(Array.isArray(body.accepts), true);
  assert.ok(body.accepts.length >= 1);
  const offer = body.accepts[0];
  assert.equal(typeof offer.amount, "string");
  assert.match(offer.amount, /^[0-9]+$/);
  assert.equal(offer.network, "eip155:8453");
  assert.equal(typeof offer.asset, "string");
  assert.equal(typeof offer.payTo, "string");
  assert.match(body.resource.url, /^https:\/\/agents\.samedaydesk\.com\/extract\?url=/);
  assert.ok(BigInt(offer.amount) > 0n);
  console.log(JSON.stringify({
    lane: "live-extract-402",
    status: response.status,
    amountAtomic: offer.amount,
    network: offer.network,
    asset: offer.asset,
    payTo: offer.payTo,
    claimedSourceSent: CLAIMED_SOURCE_VALUE,
    merchantAcceptanceAsserted: false,
  }));
});

test("unpaid initialize-era initialize and tools/list require extract and extract_batch", async () => {
  const initialize = await postRpc("initialize", {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "samedaydesk-c25-claude-marketplace", version: "0.1.1" },
  }, 1);
  assert.equal(initialize.response.ok, true, `initialize HTTP ${initialize.response.status}`);
  const result = initialize.payload.result;
  assert.ok(result, `initialize payload ${JSON.stringify(initialize.payload).slice(0, 300)}`);
  assert.equal(result.protocolVersion, MCP_PROTOCOL);
  assert.equal(result.serverInfo.name, "x402-data-gateway");
  assert.notEqual(result.protocolVersion, "2026-07-28");

  const sessionId = initialize.response.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const listed = await postRpc("tools/list", {}, 2, extra);
  assert.equal(listed.response.ok, true, `tools/list HTTP ${listed.response.status}`);
  const tools = listed.payload.result.tools;
  assert.equal(Array.isArray(tools), true);
  const found = assertExtractDiscoveryInventory(tools);
  assert.ok(found.names.includes("extract"));
  assert.ok(found.names.includes("extract_batch"));
});

test("paid extract tools/call without credentials does not deliver paid content", async () => {
  const initialize = await postRpc("initialize", {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "samedaydesk-c25-claude-marketplace", version: "0.1.1" },
  }, 11);
  assert.equal(initialize.response.ok, true);
  const sessionId = initialize.response.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const called = await postRpc("tools/call", {
    name: "extract",
    arguments: { url: "https://example.com" },
  }, 12, extra);

  const status = called.response.status;
  const payload = called.payload;
  const text = called.text;
  const paidDelivery = status === 200
    && payload?.result
    && payload.result.isError !== true
    && !/payment required/i.test(JSON.stringify(payload))
    && (payload.result.structuredContent?.ok === true || /"ok"\s*:\s*true/.test(text));

  assert.equal(paidDelivery, false, "unpaid tools/call must not return paid extract bytes");
  assert.ok(
    status === 402
      || status === 401
      || status === 403
      || (status === 200 && (payload?.error || payload?.result?.isError === true) && /payment required|payment credential|x402/i.test(text)),
    `unexpected unpaid tools/call outcome HTTP ${status} ${text.slice(0, 400)}`,
  );
  assert.equal(text.includes("PAYMENT-SIGNATURE"), false);
  console.log(JSON.stringify({
    lane: "paid-tool-no-auth",
    httpStatus: status,
    jsonrpcError: payload?.error?.message || null,
    isError: payload?.result?.isError ?? null,
    paidDelivery: false,
    paymentAttempted: false,
  }));
});
