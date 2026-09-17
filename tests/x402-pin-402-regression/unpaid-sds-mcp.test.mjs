import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapMCPClientWithPayment } from "@x402/mcp";
import { privateKeyToAccount } from "viem/accounts";

import { parsePaymentRequired } from "@x402/core/schemas";

import {
  BASE_USDC,
  LIVE_MCP_URL,
  LIVE_WELL_KNOWN_X402,
  LIVE_TIMEOUT_MS,
  NETWORK,
  PINNED_X402,
  TEN_MINUTE_SECONDS,
  assertExactBaseUsdcAccept,
  assertNoBatchSettlementOrMinDeposit,
  createRefuseToPayClient,
  mcpProbeOptions,
  postMcp,
} from "./helpers.mjs";

test("ExactEvmScheme for eip155:8453 constructs without Casper/Cardano/Celo/XRPL", () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const scheme = new ExactEvmScheme(account);
  assert.equal(scheme.scheme, "exact");
  const asset = scheme.findDefaultAsset(BASE_USDC, NETWORK);
  assert.equal(asset?.symbol, "USDC");
  assert.equal(asset?.decimals, 6);
});

test("unpaid SDS MCP tools/call still yields exact eip155:8453 USDC accepts under 2.26.0", async () => {
  const initialize = await postMcp("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "r9-09-x402-pin", version: PINNED_X402 },
  }, 1);
  assert.equal(initialize.response.ok, true, `initialize HTTP ${initialize.response.status}`);
  assert.equal(initialize.payload.result.serverInfo.name, "x402-data-gateway");

  const sessionId = initialize.response.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const called = await postMcp("tools/call", {
    name: "enrich",
    arguments: { domain: "example.com" },
  }, 3, extra);

  assert.equal(called.response.ok, true, `tools/call HTTP ${called.response.status}`);
  const result = called.payload.result;
  assert.equal(result.isError, true);
  const paymentRequired = result.structuredContent;
  assert.equal(paymentRequired.x402Version, 2);
  assert.equal(Array.isArray(paymentRequired.accepts), true);
  assert.equal(paymentRequired.accepts.length, 1);
  assertExactBaseUsdcAccept(paymentRequired.accepts[0], "live unpaid enrich");
  assert.equal(paymentRequired.accepts[0].maxTimeoutSeconds, 300);
  assert.ok(paymentRequired.accepts[0].maxTimeoutSeconds <= TEN_MINUTE_SECONDS);
  assertNoBatchSettlementOrMinDeposit(paymentRequired, "live unpaid enrich");
  const parsed = parsePaymentRequired(paymentRequired);
  assert.equal(parsed.success, true, "live enrich 402 must parse on @x402/core@2.26");

  const quoted = {
    pin: PINNED_X402,
    surface: LIVE_MCP_URL,
    tool: "enrich",
    paid: false,
    x402Version: paymentRequired.x402Version,
    accepts: paymentRequired.accepts,
  };
  console.log(JSON.stringify({ lane: "unpaid-sds-mcp-tools-call", ...quoted }));
});

test("pinned @x402/mcp client extracts live SDS 402 and never pays", async () => {
  const { paidCalls, client: paymentClient } = createRefuseToPayClient();
  const mcpClient = new Client({ name: "r9-09-x402-pin-client", version: PINNED_X402 });
  const x402Mcp = wrapMCPClientWithPayment(mcpClient, paymentClient, { autoPayment: false });
  const transport = new StreamableHTTPClientTransport(new URL(LIVE_MCP_URL));
  await x402Mcp.connect(transport);
  try {
    const probe = mcpProbeOptions();
    const error = await x402Mcp.callTool("enrich", { domain: "example.com" }, probe).then(
      (result) => {
        throw new Error(`expected unpaid throw, got ${JSON.stringify(result).slice(0, 300)}`);
      },
      (caught) => caught,
    );
    assert.equal(error.message, "Payment required");
    assert.equal(error.code, 402);
    assert.equal(error.paymentRequired.x402Version, 2);
    assert.equal(error.paymentRequired.accepts.length, 1);
    assertExactBaseUsdcAccept(error.paymentRequired.accepts[0], "x402MCPClient unpaid");
    assertNoBatchSettlementOrMinDeposit(error.paymentRequired, "x402MCPClient unpaid");
    assert.deepEqual(paidCalls, []);

    const probed = await x402Mcp.getToolPaymentRequirements("enrich", { domain: "example.com" });
    assert.equal(probed.x402Version, 2);
    assertExactBaseUsdcAccept(probed.accepts[0], "getToolPaymentRequirements");
    assert.deepEqual(paidCalls, []);
    console.log(JSON.stringify({
      lane: "unpaid-x402-mcp-client",
      pin: PINNED_X402,
      autoPayment: false,
      paidCalls,
      x402Version: error.paymentRequired.x402Version,
      accepts: error.paymentRequired.accepts,
    }));
  } finally {
    await x402Mcp.close();
  }
});

test("live /.well-known/x402 remains x402Version 2 exact USDC on Base", async () => {
  const response = await fetch(LIVE_WELL_KNOWN_X402, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": "SameDayDesk-R9-09-x402-pin/2.26.0" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.x402Version, 2);
  assert.equal(Array.isArray(body.items), true);
  assert.ok(body.items.length > 0);
  for (const item of body.items) {
    assert.equal(Array.isArray(item.accepts), true);
    assert.ok(item.accepts.length >= 1, item.resource?.url);
    for (const accept of item.accepts) {
      assertExactBaseUsdcAccept(accept, item.resource?.url);
    }
  }
  assertNoBatchSettlementOrMinDeposit(body, "well-known x402");
});
