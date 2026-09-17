import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parsePaymentRequired } from "@x402/core/schemas";
import { wrapMCPClientWithPayment } from "@x402/mcp";

import { createX402ToolMeta } from "../../../mcp-server.mjs";
import { evaluateSds402, loadPins, readJson } from "./evaluate.mjs";
import {
  BASE_USDC,
  LIVE_MCP_URL,
  LIVE_TIMEOUT_MS,
  LIVE_WELL_KNOWN_X402,
  NETWORK,
  PAY_TO,
  PINNED_X402,
  createRefuseToPayClient,
  postMcp,
} from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENRICH = readJson(join(HERE, "fixtures", "sds-enrich-402.json"));
const OVER_TAG = readJson(join(HERE, "fixtures", "sds-over-tag-402.json"));
const EMPTY = readJson(join(HERE, "fixtures", "empty-accepts-402.json")).paymentRequired;
const pins = loadPins();

test("replay SDS enrich 402: exact Base USDC under the pin, refuse-to-pay is invoked", async () => {
  const result = evaluateSds402(ENRICH, pins, "replay-enrich");
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(result.accepts[0].scheme, "exact");
  assert.equal(result.accepts[0].network, NETWORK);
  assert.equal(result.accepts[0].asset, BASE_USDC);
  assert.equal(result.accepts[0].payTo, PAY_TO);
  assert.equal(result.accepts[0].amount, "50000");

  const parsed = parsePaymentRequired(ENRICH);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));

  const { paidCalls, client } = createRefuseToPayClient();
  await assert.rejects(
    () => client.createPaymentPayload(ENRICH),
    (error) => {
      assert.match(String(error.message), /seeded: refuse to pay/);
      return true;
    },
  );
  assert.deepEqual(paidCalls, ["createPaymentPayload"]);
});

test("seeded empty accepts: parsePaymentRequired rejects and createPaymentPayload never pays", async () => {
  const parsed = parsePaymentRequired(EMPTY);
  assert.equal(parsed.success, false);
  const issue = parsed.error?.issues?.find((entry) => entry.path?.[0] === "accepts");
  assert.equal(issue?.code, "too_small");
  assert.equal(issue?.minimum, 1);

  const { paidCalls, client } = createRefuseToPayClient();
  await assert.rejects(
    () => client.createPaymentPayload(EMPTY),
    (error) => {
      assert.match(String(error.message), /No network\/scheme registered/);
      assert.match(String(error.message), /"paymentRequirements":\[\]/);
      console.log(JSON.stringify({
        lane: "seeded-empty-accepts-throw",
        paidCalls,
        error: error.message,
      }));
      return true;
    },
  );
  assert.deepEqual(paidCalls, []);
});

test("seeded empty accepts: auto-pay MCP client never pays a tool-result 402", async () => {
  const { paidCalls, client: paymentClient } = createRefuseToPayClient();
  const fakeMcp = {
    async callTool() {
      return {
        isError: true,
        structuredContent: EMPTY,
        content: [{ type: "text", text: JSON.stringify(EMPTY) }],
      };
    },
  };
  const x402Mcp = wrapMCPClientWithPayment(fakeMcp, paymentClient, {
    autoPayment: true,
    onPaymentRequested: async () => {
      throw new Error("onPaymentRequested must not run for empty accepts");
    },
  });
  const result = await x402Mcp.callTool("enrich", { domain: "example.com" });
  assert.equal(result.isError, true);
  assert.equal(result.paymentMade, false);
  assert.deepEqual(paidCalls, []);
});

test("seeded over-tag 402: parsePaymentRequired rejects and auto-pay never pays", async () => {
  const evaluated = evaluateSds402(OVER_TAG, pins, "over-tag");
  assert.equal(evaluated.ok, false);
  assert.ok(evaluated.failures.some((failure) => failure.code === "resource-tags-too-big"));
  const parsed = parsePaymentRequired(OVER_TAG);
  assert.equal(parsed.success, false);

  const { paidCalls, client: paymentClient } = createRefuseToPayClient();
  const fakeMcp = {
    async callTool() {
      return {
        isError: true,
        structuredContent: OVER_TAG,
        content: [{ type: "text", text: JSON.stringify(OVER_TAG) }],
      };
    },
  };
  const x402Mcp = wrapMCPClientWithPayment(fakeMcp, paymentClient, {
    autoPayment: true,
    onPaymentRequested: async () => {
      throw new Error("onPaymentRequested must not run for unparseable over-tag 402");
    },
  });
  const result = await x402Mcp.callTool("agent_discoverability_audit", {
    origin: "https://agents.samedaydesk.com",
    intent: "public company enrichment and extract for agents",
  });
  assert.equal(result.isError, true);
  assert.equal(result.paymentMade, false);
  assert.deepEqual(paidCalls, []);
});

test("merchant MCP metadata still throws on empty accepts", () => {
  assert.throws(() => createX402ToolMeta([]), /at least one payment option/);
});

test("unpaid SDS MCP tools/call still yields exact eip155:8453 USDC accepts under the pin", async () => {
  const initialize = await postMcp("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "x50-x402-pin-regression", version: PINNED_X402 },
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
  const evaluated = evaluateSds402(paymentRequired, pins, "live-unpaid-enrich");
  assert.equal(evaluated.ok, true, JSON.stringify(evaluated.failures));
  assert.equal(paymentRequired.accepts[0].maxTimeoutSeconds, 300);
  console.log(JSON.stringify({
    lane: "unpaid-sds-mcp-tools-call",
    pin: PINNED_X402,
    surface: LIVE_MCP_URL,
    tool: "enrich",
    paid: false,
    x402Version: paymentRequired.x402Version,
    accepts: paymentRequired.accepts,
  }));
});

test("live /.well-known/x402 remains x402Version 2 exact USDC on Base", async () => {
  const response = await fetch(LIVE_WELL_KNOWN_X402, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": `SameDayDesk-X50-x402-pin-regression/${PINNED_X402}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.x402Version, 2);
  assert.equal(Array.isArray(body.items), true);
  assert.ok(body.items.length > 0);
  for (const item of body.items) {
    const evaluated = evaluateSds402({
      x402Version: 2,
      resource: item.resource ?? { url: item.resource?.url ?? "https://agents.samedaydesk.com/" },
      accepts: item.accepts,
    }, pins, item.resource?.url ?? "well-known-item");
    assert.equal(evaluated.ok, true, JSON.stringify({ url: item.resource?.url, failures: evaluated.failures }));
  }
  assert.equal(JSON.stringify(body).includes("batch-settlement"), false);
  assert.equal(JSON.stringify(body).includes("minDeposit"), false);
});

test("pinned @x402/mcp source still documents 2.16.0", () => {
  const pkgPath = join(HERE, "..", "..", "..", "node_modules", "@x402", "mcp", "package.json");
  assert.equal(existsSync(pkgPath), true);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.equal(pkg.version, PINNED_X402);
});
