import assert from "node:assert/strict";
import test from "node:test";

const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const TEST_USER_AGENT = "SameDayDesk-C16-goose-native/0.1.0";
const MCP_PROTOCOL = "2025-11-25";
const EXPECTED_TOOLS = [
  "extract",
  "read",
  "scan",
  "schemaforge",
  "enrich",
  "wallet_enrich",
  "deep_audit",
  "morpho_position",
  "morpho_protection",
  "morpho_market_underwrite",
  "morpho_preliquidation_replay",
  "opportunity_preflight",
  "agent_discoverability_audit",
  "payment_offer_preflight",
  "seller_integrity_audit",
  "contract_qualified_search",
  "agent_surface_budget_audit",
  "settlement_proof",
  "transaction_receipt",
  "solana_transaction_receipt",
  "wallet_policy_conformance",
  "stateful_wallet_policy_conformance",
];
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

test("goose live unpaid discovery is initialize plus tools/list with no source header", async () => {
  const initialize = await postRpc("initialize", {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "samedaydesk-c16-goose-native", version: "0.1.0" },
  }, 1);
  assert.equal(initialize.response.ok, true, `initialize HTTP ${initialize.response.status}`);
  assert.equal(initialize.payload.result.protocolVersion, MCP_PROTOCOL);
  assert.equal(initialize.payload.result.serverInfo.name, "x402-data-gateway");
  const sessionId = initialize.response.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const listed = await postRpc("tools/list", {}, 2, extra);
  assert.equal(listed.response.ok, true, `tools/list HTTP ${listed.response.status}`);
  const names = listed.payload.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, EXPECTED_TOOLS);
  const extract = listed.payload.result.tools.find((tool) => tool.name === "extract");
  const schema = extract.inputSchema || extract.input_schema || {};
  assert.ok("url" in schema.properties);
  console.log(JSON.stringify({
    lane: "goose-live-unpaid-discovery",
    toolCount: names.length,
    extractPresent: true,
    sourceHeaderSent: false,
    fixtureLoader: false,
    gooseInfo: false,
    paymentAttempted: false,
  }));
});
