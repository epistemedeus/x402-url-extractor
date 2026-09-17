import assert from "node:assert/strict";
import test from "node:test";

import { parsePaymentRequired } from "@x402/core/schemas";
import { wrapMCPClientWithPayment } from "@x402/mcp";

import { resourceInfoForX402 } from "../../mcp-server.mjs";
import {
  SDS_ENRICH_PAYMENT_REQUIRED,
  SDS_OVER_TAG_PAYMENT_REQUIRED,
  assertExactBaseUsdcAccept,
  assertNoBatchSettlementOrMinDeposit,
  createRefuseToPayClient,
  parseSseOrJson,
} from "./helpers.mjs";

test("replay SDS enrich 402: 2.26 schema accepts exact Base USDC and refuse-to-pay is invoked", async () => {
  const parsed = parsePaymentRequired(SDS_ENRICH_PAYMENT_REQUIRED);
  assert.equal(parsed.success, true);
  assertExactBaseUsdcAccept(parsed.data.accepts[0], "replay enrich");
  assertNoBatchSettlementOrMinDeposit(parsed.data, "replay enrich");
  assert.equal(parsed.data.resource.tags.length, 3);

  const { paidCalls, client } = createRefuseToPayClient();
  await assert.rejects(
    () => client.createPaymentPayload(SDS_ENRICH_PAYMENT_REQUIRED),
    (error) => {
      assert.match(String(error.message), /seeded: refuse to pay/);
      console.log(JSON.stringify({
        lane: "seeded-sds-enrich-402-replay-refuse",
        paidCalls,
        error: error.message,
      }));
      return true;
    },
  );
  assert.deepEqual(paidCalls, ["createPaymentPayload"]);
});

test("replay SDS over-tag 402: parsePaymentRequired rejects and auto-pay never pays", async () => {
  const parsed = parsePaymentRequired(SDS_OVER_TAG_PAYMENT_REQUIRED);
  assert.equal(parsed.success, false);
  const issue = parsed.error?.issues?.find((entry) => entry.path?.[0] === "resource" && entry.path?.[1] === "tags");
  assert.equal(issue?.code, "too_big");
  assert.equal(issue?.maximum, 5);
  assert.equal(SDS_OVER_TAG_PAYMENT_REQUIRED.resource.tags.length, 10);

  const { paidCalls, client: paymentClient } = createRefuseToPayClient();
  const fakeMcp = {
    async callTool() {
      return {
        isError: true,
        structuredContent: SDS_OVER_TAG_PAYMENT_REQUIRED,
        content: [{ type: "text", text: JSON.stringify(SDS_OVER_TAG_PAYMENT_REQUIRED) }],
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
  assert.equal(result.paymentRequired, undefined);
  assert.deepEqual(paidCalls, []);
  console.log(JSON.stringify({
    lane: "seeded-sds-over-tag-402-replay",
    tagCount: SDS_OVER_TAG_PAYMENT_REQUIRED.resource.tags.length,
    parseSuccess: parsed.success,
    paidCalls,
    paymentMade: result.paymentMade,
  }));
});

test("resourceInfoForX402 clamps tags so a 2.26 PaymentRequired parses", () => {
  const clamped = resourceInfoForX402({
    url: SDS_OVER_TAG_PAYMENT_REQUIRED.resource.url,
    description: SDS_OVER_TAG_PAYMENT_REQUIRED.resource.description,
    mimeType: "application/json",
    serviceName: SDS_OVER_TAG_PAYMENT_REQUIRED.resource.serviceName,
    tags: SDS_OVER_TAG_PAYMENT_REQUIRED.resource.tags,
  });
  assert.deepEqual(clamped.tags, SDS_OVER_TAG_PAYMENT_REQUIRED.resource.tags.slice(0, 5));
  const parsed = parsePaymentRequired({
    ...SDS_OVER_TAG_PAYMENT_REQUIRED,
    resource: clamped,
  });
  assert.equal(parsed.success, true);
  assertExactBaseUsdcAccept(parsed.data.accepts[0], "clamped over-tag");
});

test("parseSseOrJson prefers the JSON-RPC message matching the request id", () => {
  const sse = [
    "event: message",
    "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}",
    "",
    "event: message",
    "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/ping\"}",
    "",
  ].join("\n");
  assert.equal(parseSseOrJson(sse, "sse", 1).result.ok, true);
  const trailing = `${sse}data: {\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{\"ok\":false}}\n`;
  assert.equal(parseSseOrJson(trailing, "sse-trailing", 1).id, 1);
});
