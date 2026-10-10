import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";

import {
  CALLER_RESULT_FEEDBACK_TTL_MS,
  attachMcpCallerResultFeedback,
  issueCallerResultFeedbackToken,
  issueMcpCallerResultFeedbackToken,
  mcpCallerResultFeedbackPublicContract,
  readCallerResultFeedbackToken,
  readMcpCallerResultFeedbackToken,
} from "./caller-result-feedback.mjs";
import { digestMcpCallId, digestMcpPayload } from "./http-delivery-evidence/digest.mjs";
import { MCP_MORPHO_RESOURCE, MCP_MORPHO_TOOL } from "./http-delivery-evidence/mcp-delivery.mjs";
import { createDeliveryObservation } from "./http-delivery-evidence/observation.mjs";
import { adaptMcpTypedDecisionToCommerceEvent, isCanonicalMcpTypedCommerceEvent } from "./commerce-events.mjs";
import { evaluateMcpTypedTelemetryOutcome } from "./mcp-typed-telemetry-producer.mjs";
import { bindPaidMcpCallerResult, readMcpCallerResultCapability, reportMcpCallerResult } from "./mcp-caller-result.mjs";

const KEY = randomBytes(32).toString("hex");
const NOW = Date.parse("2026-10-10T16:00:00.000Z");
const TX = `0x${"a".repeat(64)}`;

function observation() {
  const payload = Buffer.from('{"ok":true,"positionCount":1}', "utf8");
  const callId = "7";
  return createDeliveryObservation({
    source: "mcp_tool_result",
    responseDigest: digestMcpPayload(payload),
    responseByteLength: payload.length,
    tool: MCP_MORPHO_TOOL,
    productSku: "samedaydesk-morpho-position",
    resource: MCP_MORPHO_RESOURCE,
    issuedOfferDigest: "ab".repeat(32),
    callId,
    callDigest: digestMcpCallId(callId),
    settlementReference: TX,
    applicationIsError: false,
    payload,
  });
}

function token() {
  return issueMcpCallerResultFeedbackToken({ key: KEY, observation: observation(), now: NOW });
}

test("mcp capability is channel qualified and stays out of the http reader", () => {
  const issued = token();
  assert.equal(typeof issued, "string");
  const read = readMcpCallerResultFeedbackToken(issued, KEY, NOW);
  assert.equal(read.ok, true);
  assert.equal(read.claims.channel, "mcp");
  assert.equal(read.claims.tool, MCP_MORPHO_TOOL);
  assert.equal(Object.hasOwn(read.claims, "eventId"), false);
  assert.equal(readCallerResultFeedbackToken(issued, KEY, NOW).code, "tampered_capability");
  const http = issueCallerResultFeedbackToken({
    key: KEY,
    eventId: "11111111-1111-4111-8111-111111111111",
    method: "GET",
    route: "/extract",
    requestDigest: "cd".repeat(32),
    responseDigest: "ef".repeat(32),
    now: NOW,
  });
  assert.equal(readMcpCallerResultFeedbackToken(http, KEY, NOW).code, "channel_rejected");
  const contract = JSON.stringify(mcpCallerResultFeedbackPublicContract());
  assert.equal(contract.includes("http"), false);
  assert.equal(contract.includes("/commerce/"), false);
});

test("mcp capability rejects foreign, expired, tampered, and client event identity", () => {
  const issued = token();
  const dot = issued.indexOf(".");
  const claims = JSON.parse(Buffer.from(issued.slice(0, dot), "base64url").toString("utf8"));
  const resign = (next) => {
    const payload = Buffer.from(JSON.stringify(next));
    const mac = createHmac("sha256", KEY).update(payload).digest();
    return `${payload.toString("base64url")}.${mac.toString("base64url")}`;
  };
  assert.equal(readMcpCallerResultFeedbackToken(resign({ ...claims, t: "extract" }), KEY, NOW).code, "foreign_tool");
  assert.equal(readMcpCallerResultFeedbackToken(resign({ ...claims, x: NOW - 1 }), KEY, NOW).code, "expired_capability");
  assert.equal(readMcpCallerResultFeedbackToken(resign({ ...claims, e: "11111111-1111-4111-8111-111111111111" }), KEY, NOW).code, "tampered_capability");
  const signatureStart = issued.indexOf(".") + 1;
  const flipped = issued.slice(0, signatureStart)
    + (issued[signatureStart] === "a" ? "b" : "a") + issued.slice(signatureStart + 1);
  assert.equal(readMcpCallerResultFeedbackToken(flipped, KEY, NOW).code, "tampered_capability");
  assert.equal(readMcpCallerResultFeedbackToken(issued, KEY, NOW + CALLER_RESULT_FEEDBACK_TTL_MS).code, "expired_capability");
});

test("attach publishes the capability only on eligible sealed morpho meta", () => {
  const result = { content: [{ type: "text", text: '{"ok":true}' }], structuredContent: { ok: true } };
  assert.equal(attachMcpCallerResultFeedback(result, {
    key: KEY,
    observation: observation(),
    eligible: false,
  }), false);
  assert.equal(result._meta, undefined);
  assert.equal(attachMcpCallerResultFeedback(result, {
    key: KEY,
    observation: observation(),
    eligible: true,
  }), true);
  const capability = readMcpCallerResultCapability(result);
  assert.equal(capability.present, true);
  assert.equal(result.content[0].text.includes(capability.token), false);
  assert.equal(JSON.stringify(result.structuredContent).includes(capability.token), false);
  assert.equal(JSON.stringify(result._meta).includes("https://"), false);
});

test("the mcp client reports through callTool and does not echo a transport failure", async () => {
  const issued = token();
  const accepted = await reportMcpCallerResult({
    async callTool(params) {
      assert.equal(params.name, "report_caller_result");
      assert.equal(params.arguments.token, issued);
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          accepted: true,
          bound: true,
          charged: false,
          payerIdentity: false,
          usefulness: "unknown",
          disposition: "useful",
          reasonCategory: "matched_task",
          idempotentReplay: false,
          coverage: "this_retained_result_only",
        }) }],
      };
    },
  }, { token: issued, disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.disposition, "useful");
  assert.equal(JSON.stringify(accepted).includes(issued), false);

  const leaked = await reportMcpCallerResult({
    async callTool() {
      return { content: [{ type: "text", text: issued }] };
    },
  }, { token: issued, disposition: "not_useful" });
  assert.equal(leaked.code, "bearer_retained");
  assert.equal(JSON.stringify(leaked).includes(issued), false);

  const failed = await reportMcpCallerResult({
    async callTool() {
      throw new Error(`connect failed ${issued}`);
    },
  }, { token: issued, disposition: "useful" });
  assert.equal(failed.code, "transport_failed");
  assert.equal(failed.usefulness, "unknown");
  assert.equal(JSON.stringify(failed).includes(issued), false);
});

test("facilitator settlement facts stay canonical without becoming chain truth", () => {
  const digest = "ab".repeat(32);
  const decision = evaluateMcpTypedTelemetryOutcome({
    schemaVersion: "samedaydesk.mcp-typed-telemetry-input.v1",
    binding: {
      tool: "morpho_position",
      productSku: "samedaydesk-morpho-position",
      resource: "mcp://tool/morpho_position",
      issuedOfferDigest: digest,
    },
    request: { jsonrpc: "2.0", hasId: true, id: 7, method: "tools/call" },
    response: { hasId: true, id: 7, kind: "tool_result" },
    credential: { state: "verified", offerDigest: digest },
    execution: { state: "handler_success", handlerInvoked: true, resultIsError: false },
    settlement: { state: "succeeded", offerDigest: digest },
  });
  const bare = adaptMcpTypedDecisionToCommerceEvent(decision, {
    facilitatorSettlement: { transaction: TX },
  });
  assert.equal(bare.settlementReference, undefined);
  assert.equal(bare.chainTruth, false);
  assert.equal(isCanonicalMcpTypedCommerceEvent(bare), true);
  const settled = adaptMcpTypedDecisionToCommerceEvent(decision, {
    facilitatorSettlement: {
      transaction: TX,
      network: "eip155:8453",
      amount: "20000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payee: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    },
  });
  assert.equal(settled.route, "/mcp");
  assert.equal(settled.paymentProtocol, "x402");
  assert.equal(settled.settlementReference, TX);
  assert.equal(settled.settlementAmountAtomic, "20000");
  assert.equal(settled.chainTruth, false);
  assert.equal(settled.accounting, false);
  assert.equal(settled.revenue, false);
  assert.equal(settled.payerIdentity, false);
  assert.equal(isCanonicalMcpTypedCommerceEvent(settled), true);
  assert.equal(isCanonicalMcpTypedCommerceEvent({ ...settled, chainTruth: true }), false);
  assert.equal(isCanonicalMcpTypedCommerceEvent({ ...bare, settlementReference: TX }), false);
});

test("the official wrapper hook retains the sealed result and callTool stays positional", async () => {
  const issued = token();
  const contract = { ...mcpCallerResultFeedbackPublicContract(), token: issued };
  const hooks = [];
  const calls = [];
  const client = {
    get client() {
      return { callTool: (params) => this.callTool(params.name, params.arguments) };
    },
    onAfterPayment(hook) {
      hooks.push(hook);
      return this;
    },
    async callTool(name, args) {
      calls.push({ name, args, form: "positional" });
      if (name === "morpho_position") {
        const content = [{ type: "text", text: "{\"ok\":true}" }];
        await hooks[0]({
          result: {
            content,
            _meta: { "samedaydesk/mcp-caller-result": contract },
          },
        });
        return { content, paymentMade: true };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            accepted: true,
            bound: false,
            parent: "pending",
            charged: false,
            payerIdentity: false,
            usefulness: "unknown",
            disposition: "useful",
            reasonCategory: "matched_task",
            idempotentReplay: false,
            coverage: "this_retained_result_only",
          }),
        }],
      };
    },
    async callToolWithPayment(name, args, payment) {
      calls.push({ name, args, payment: Boolean(payment), form: "upfront" });
      return { content: [{ type: "text", text: "{\"ok\":true}" }], paymentMade: true, isError: false };
    },
  };
  const paid = bindPaidMcpCallerResult(client);
  const purchase = await paid.pay("morpho_position", { address: "fixture" });
  assert.equal(purchase.paymentMade, true);
  assert.equal(purchase.returnedCapability, false);
  assert.equal(purchase.capability.present, true);
  assert.equal(purchase.capability.token, issued);
  const reported = await paid.report({ token: issued, disposition: "useful", reasonCategory: "matched_task" });
  assert.equal(reported.accepted, true);
  assert.equal(reported.bound, false);
  assert.equal(reported.parent, "pending");
  assert.equal(calls[0].name, "morpho_position");
  assert.equal(calls[0].form, "positional");
  assert.equal(calls[1].name, "report_caller_result");
  assert.equal(calls[1].args.disposition, "useful");
  const upfront = await paid.payWithPayment("opportunity_preflight", { rewardUsd: 10 }, { accepted: true });
  assert.equal(upfront.paymentMade, true);
  assert.equal(upfront.returnedCapability, false);
  assert.equal(upfront.capability.present, false);
  assert.equal(calls[2].form, "upfront");
  assert.equal(calls[2].name, "opportunity_preflight");
  assert.equal(JSON.stringify(reported).includes(issued), false);
});

test("overlapping purchases keep their own sealed capability", async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const hooks = [];
  const issuedA = `${"A".repeat(24)}.${"A".repeat(43)}`;
  const issuedB = `${"B".repeat(24)}.${"B".repeat(43)}`;
  const client = {
    onAfterPayment(hook) { hooks.push(hook); },
    async callTool(name, args) {
      const content = [{ type: "text", text: args.id }];
      await wait(args.id === "A" ? 0 : 5);
      for (const hook of hooks) await hook({
        toolName: name,
        result: { content, _meta: { "samedaydesk/mcp-caller-result": {
          ...mcpCallerResultFeedbackPublicContract(),
          token: args.id === "A" ? issuedA : issuedB,
        } } },
      });
      await wait(args.id === "A" ? 15 : 0);
      return { content, paymentMade: true };
    },
  };
  const paid = bindPaidMcpCallerResult(client);
  const [a, b] = await Promise.all([
    paid.pay("morpho_position", { id: "A" }),
    paid.pay("morpho_position", { id: "B" }),
  ]);
  assert.equal(a.content[0].text, "A");
  assert.equal(a.capability.token, issuedA);
  assert.equal(b.content[0].text, "B");
  assert.equal(b.capability.token, issuedB);
});

test("free reporting uses the raw SDK and cannot invoke automatic payment", async () => {
  let paymentCalls = 0;
  let sdkCalls = 0;
  const issued = token();
  const client = {
    onAfterPayment() {},
    async callTool() { paymentCalls += 1; throw new Error("automatic payment path"); },
    client: {
      async callTool(params) {
        sdkCalls += 1;
        assert.equal(params.name, "report_caller_result");
        assert.equal(params.arguments.token, issued);
        return { content: [{ type: "text", text: JSON.stringify({
          ok: true, accepted: true, bound: false, parent: "pending",
          charged: false, disposition: "useful",
        }) }] };
      },
    },
  };
  const result = await reportMcpCallerResult(client, { token: issued, disposition: "useful" });
  assert.equal(result.accepted, true);
  assert.equal(sdkCalls, 1);
  assert.equal(paymentCalls, 0);
  delete client.client;
  const absent = await reportMcpCallerResult(client, { token: issued, disposition: "useful" });
  assert.equal(absent.code, "transport_failed");
  assert.equal(paymentCalls, 0);
});
