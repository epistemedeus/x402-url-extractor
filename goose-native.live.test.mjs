import assert from "node:assert/strict";
import test from "node:test";

import { assertExtractDiscoveryInventory } from "./extract-discovery-inventory.mjs";

const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const TEST_USER_AGENT = "SameDayDesk-C25-goose-native/0.1.1";
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
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_BYTES, `${method} response too large`);
  return { response, text, payload: parseSseOrJson(text, method) };
}

test("goose live unpaid discovery requires extract and extract_batch schemas", async () => {
  const initialize = await postRpc("initialize", {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "samedaydesk-c25-goose-native", version: "0.1.1" },
  }, 1);
  assert.equal(initialize.response.ok, true, `initialize HTTP ${initialize.response.status}`);
  assert.equal(initialize.payload.result.protocolVersion, MCP_PROTOCOL);
  assert.equal(initialize.payload.result.serverInfo.name, "x402-data-gateway");
  const sessionId = initialize.response.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const listed = await postRpc("tools/list", {}, 2, extra);
  assert.equal(listed.response.ok, true, `tools/list HTTP ${listed.response.status}`);
  const tools = listed.payload.result.tools;
  const found = assertExtractDiscoveryInventory(tools);
  assert.ok(found.names.includes("extract"));
  assert.ok(found.names.includes("extract_batch"));
  console.log(JSON.stringify({
    lane: "goose-live-unpaid-discovery",
    toolCount: found.names.length,
    extractPresent: true,
    extractBatchPresent: true,
    sourceHeaderSent: false,
    fixtureLoader: false,
    gooseInfo: false,
    paymentAttempted: false,
    exactGlobalCountRequired: false,
  }));
});
