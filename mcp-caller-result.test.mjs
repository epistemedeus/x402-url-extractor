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
import { readMcpCallerResultCapability, reportMcpCallerResult } from "./mcp-caller-result.mjs";

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
  const flipped = `${issued.slice(0, -1)}${issued.endsWith("a") ? "b" : "a"}`;
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
