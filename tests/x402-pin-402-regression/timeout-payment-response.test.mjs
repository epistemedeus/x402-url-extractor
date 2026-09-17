import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  MCP_PAYMENT_META_KEY,
  MCP_PAYMENT_RESPONSE_META_KEY,
  attachPaymentResponseToMeta,
  extractPaymentResponseFromMeta,
  wrapMCPClientWithPayment,
} from "@x402/mcp";

import {
  BASE_USDC,
  NETWORK,
  PAY_TO,
  PINNED_X402,
  REPO_ROOT,
  TEN_MINUTE_SECONDS,
  createRefuseToPayClient,
} from "./helpers.mjs";

const MCP_SOURCE = readFileSync(
  join(REPO_ROOT, "node_modules", "@x402", "mcp", "dist", "esm", "index.mjs"),
  "utf8",
);

const DUMMY_ACCEPTED = {
  scheme: "exact",
  network: NETWORK,
  amount: "50000",
  asset: BASE_USDC,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};

const DUMMY_PAYLOAD = {
  x402Version: 2,
  resource: { url: "mcp://tool/enrich", mimeType: "application/json" },
  accepted: DUMMY_ACCEPTED,
  payload: { signature: "0xdead", authorization: { from: "0xabc" } },
};

const SETTLE_RESPONSE = {
  success: true,
  transaction: `0x${"ab".repeat(32)}`,
  network: NETWORK,
  payer: "0x990CC4f469dfe854c16C601c7B8eE6534B267f17",
};

test("@x402/mcp@2.26.0 defaults maxRequestTimeoutSeconds to 10 minutes", () => {
  assert.match(MCP_SOURCE, /DEFAULT_MAX_REQUEST_TIMEOUT_SECONDS = 600/);
  assert.equal(TEN_MINUTE_SECONDS, 600);
  assert.match(
    readFileSync(join(REPO_ROOT, "node_modules", "@x402", "mcp", "package.json"), "utf8"),
    new RegExp(`"version": "${PINNED_X402}"`),
  );
});

test("invalid maxRequestTimeoutSeconds throws instead of paying", () => {
  const { paidCalls, client } = createRefuseToPayClient();
  assert.throws(
    () => wrapMCPClientWithPayment({ callTool() {} }, client, { maxRequestTimeoutSeconds: 0 }),
    /maxRequestTimeoutSeconds must be a positive finite number, got 0/,
  );
  assert.throws(
    () => wrapMCPClientWithPayment({ callTool() {} }, client, { maxRequestTimeoutSeconds: -1 }),
    /maxRequestTimeoutSeconds must be a positive finite number, got -1/,
  );
  assert.deepEqual(paidCalls, []);
});

test("paid retry timeout is capped at 10 minutes from accept maxTimeoutSeconds", async () => {
  const { client: paymentClient } = createRefuseToPayClient();
  const calls = [];
  const fakeMcp = {
    async callTool(params, _schema, options) {
      calls.push({
        timeout: options?.timeout,
        hasPayment: Boolean(params?._meta?.[MCP_PAYMENT_META_KEY]),
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        _meta: { [MCP_PAYMENT_RESPONSE_META_KEY]: SETTLE_RESPONSE },
      };
    },
  };
  const x402Mcp = wrapMCPClientWithPayment(fakeMcp, paymentClient, { autoPayment: false });
  const overCap = {
    ...DUMMY_PAYLOAD,
    accepted: { ...DUMMY_ACCEPTED, maxTimeoutSeconds: 900 },
  };
  const result = await x402Mcp.callToolWithPayment("enrich", { domain: "example.com" }, overCap);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hasPayment, true);
  assert.equal(calls[0].timeout, TEN_MINUTE_SECONDS * 1000);
  assert.equal(result.paymentMade, true);
  assert.deepEqual(result.paymentResponse, SETTLE_RESPONSE);
});

test("SDS 300s accept stays under the 10m cap on paid retry", async () => {
  const { client: paymentClient } = createRefuseToPayClient();
  const calls = [];
  const fakeMcp = {
    async callTool(_params, _schema, options) {
      calls.push(options?.timeout);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        _meta: { [MCP_PAYMENT_RESPONSE_META_KEY]: SETTLE_RESPONSE },
      };
    },
  };
  const x402Mcp = wrapMCPClientWithPayment(fakeMcp, paymentClient);
  await x402Mcp.callToolWithPayment("enrich", { domain: "example.com" }, DUMMY_PAYLOAD);
  assert.deepEqual(calls, [300_000]);
});

test("paymentResponse is read from _meta x402/payment-response and missing success is ignored", () => {
  assert.equal(MCP_PAYMENT_RESPONSE_META_KEY, "x402/payment-response");
  const attached = attachPaymentResponseToMeta(
    { content: [{ type: "text", text: "{\"ok\":true}" }] },
    SETTLE_RESPONSE,
  );
  assert.deepEqual(extractPaymentResponseFromMeta(attached), SETTLE_RESPONSE);
  assert.equal(extractPaymentResponseFromMeta({ content: [] }), null);
  assert.equal(
    extractPaymentResponseFromMeta({
      content: [],
      _meta: { [MCP_PAYMENT_RESPONSE_META_KEY]: { transaction: "0x1" } },
    }),
    null,
  );
});

test("callToolWithPayment surfaces paymentResponse without enabling batch-settlement", async () => {
  const { paidCalls, client: paymentClient } = createRefuseToPayClient();
  const fakeMcp = {
    async callTool(params) {
      assert.equal(params.name, "enrich");
      assert.ok(params._meta[MCP_PAYMENT_META_KEY]);
      assert.equal("batch-settlement" in params._meta, false);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, domain: "example.com" }) }],
        _meta: { [MCP_PAYMENT_RESPONSE_META_KEY]: SETTLE_RESPONSE },
      };
    },
  };
  const x402Mcp = wrapMCPClientWithPayment(fakeMcp, paymentClient, { autoPayment: false });
  const result = await x402Mcp.callToolWithPayment("enrich", { domain: "example.com" }, DUMMY_PAYLOAD);
  assert.equal(result.paymentMade, true);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.paymentResponse, SETTLE_RESPONSE);
  assert.equal(result.paymentResponse.network, NETWORK);
  assert.equal(result.paymentResponse.success, true);
  assert.deepEqual(paidCalls, []);
});
