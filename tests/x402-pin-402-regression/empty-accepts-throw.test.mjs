import assert from "node:assert/strict";
import test from "node:test";

import { parsePaymentRequired } from "@x402/core/schemas";
import { wrapMCPClientWithPayment } from "@x402/mcp";

import { createX402ToolMeta } from "../../mcp-server.mjs";
import {
  EMPTY_ACCEPTS_PAYMENT_REQUIRED,
  createRefuseToPayClient,
} from "./helpers.mjs";

test("seeded empty accepts: parsePaymentRequired rejects rather than selecting a pay path", () => {
  const parsed = parsePaymentRequired(EMPTY_ACCEPTS_PAYMENT_REQUIRED);
  assert.equal(parsed.success, false);
  const issue = parsed.error?.issues?.find((entry) => entry.path?.[0] === "accepts");
  assert.equal(issue?.code, "too_small");
  assert.equal(issue?.minimum, 1);
});

test("seeded empty accepts: x402Client.createPaymentPayload throws and never pays", async () => {
  const { paidCalls, client } = createRefuseToPayClient();
  await assert.rejects(
    () => client.createPaymentPayload(EMPTY_ACCEPTS_PAYMENT_REQUIRED),
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

test("seeded empty accepts: auto-pay MCP client throws JSON-RPC 402 and never pays", async () => {
  const { paidCalls, client: paymentClient } = createRefuseToPayClient();
  const fakeMcp = {
    async callTool() {
      const error = new Error("Payment required");
      error.code = -32042;
      error.data = { ...EMPTY_ACCEPTS_PAYMENT_REQUIRED, accepts: [] };
      throw error;
    },
  };
  const x402Mcp = wrapMCPClientWithPayment(fakeMcp, paymentClient, { autoPayment: true });
  await assert.rejects(
    () => x402Mcp.callTool("enrich", { domain: "example.com" }),
    (error) => {
      assert.equal(error.message, "Payment required");
      assert.equal(error.code, -32042);
      assert.deepEqual(error.data.accepts, []);
      return true;
    },
  );
  assert.deepEqual(paidCalls, []);
});

test("seeded empty accepts: tool-result 402 does not auto-pay", async () => {
  const { paidCalls, client: paymentClient } = createRefuseToPayClient();
  const fakeMcp = {
    async callTool() {
      return {
        isError: true,
        structuredContent: EMPTY_ACCEPTS_PAYMENT_REQUIRED,
        content: [{ type: "text", text: JSON.stringify(EMPTY_ACCEPTS_PAYMENT_REQUIRED) }],
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
  assert.equal(result.paymentResponse, undefined);
  assert.deepEqual(paidCalls, []);
});

test("merchant MCP metadata still throws on empty accepts", () => {
  assert.throws(() => createX402ToolMeta([]), /at least one payment option/);
});
