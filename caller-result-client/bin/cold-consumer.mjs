#!/usr/bin/env node
// Installed consumer. Declared dependencies only. No merchant source, wallet, or signer.
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402MCPClient } from "@x402/mcp";

import {
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
  bindCallerResultFeedback,
  reportCallerResult,
} from "../src/http-caller-result.mjs";
import {
  bindPaidMcpCallerResult,
  readMcpCallerResultCapability,
  reportMcpCallerResult,
} from "../src/mcp-caller-result.mjs";
import { mcpCallerResultFeedbackPublicContract } from "../src/contract.mjs";

const NETWORK = "eip155:8453";
const SYNTHETIC_FROM = `0x${"2".repeat(40)}`;
const secrets = [];

function remember(value) {
  if (typeof value === "string" && value.length > 0) secrets.push(value);
  return value;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      await readFile(file);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await sleep(40);
    }
  }
  fail("signal_timeout");
}

function syntheticPayment(paymentRequired) {
  const accepts = paymentRequired?.accepts;
  if (!Array.isArray(accepts)) return null;
  const accepted = accepts.find((entry) => entry?.network === NETWORK && entry?.scheme === "exact")
    || accepts.find((entry) => entry?.scheme === "exact");
  if (!accepted || typeof accepted.payTo !== "string" || typeof accepted.amount !== "string") return null;
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"4".repeat(130)}`,
      authorization: {
        from: SYNTHETIC_FROM,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: `0x${randomBytes(32).toString("hex")}`,
      },
    },
    extensions: {},
  };
}

function decodeMcpBody(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return null;
  const payload = String(contentType || "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("")
    : text;
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

async function challengeFor(mcpUrl, name, args) {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomBytes(4).toString("hex"),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const json = decodeMcpBody(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type"));
  const structured = json?.result?.structuredContent?.accepts?.[0]
    || json?.error?.data?.accepts?.[0];
  if (structured) return structured;
  const text = json?.result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text).accepts?.[0] || null; } catch { return null; }
}

async function openCaller(mcpUrl) {
  const sdk = new Client({ name: "samedaydesk-caller-result", version: "0.1.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  await sdk.listTools();
  const wrapped = new x402MCPClient(sdk, {
    async handlePaymentResponse() {
      return { recovered: false };
    },
  }, { autoPayment: false });
  wrapped.onPaymentRequired(async ({ paymentRequired }) => {
    const payment = syntheticPayment(paymentRequired);
    if (!payment) return { abort: true };
    return { payment };
  });
  return { sdk, caller: bindPaidMcpCallerResult(wrapped), wrapped };
}

function independent(statement) {
  return statement.accepted === true && statement.bound === false && statement.parent === "pending";
}

async function httpSelfCheck() {
  const posts = [];
  const token = remember(`${"h".repeat(24)}.${"h".repeat(43)}`);
  const result = {};
  const preserved = { delivered: true };
  Object.assign(result, preserved);
  bindCallerResultFeedback(result, {
    response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: token } }),
    resourceUrl: "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com",
  });
  const reported = await reportCallerResult(result, {
    disposition: "useful",
    reasonCategory: "matched_task",
  }, {
    fetchImpl: async (url, init) => {
      posts.push(String(url));
      const request = new Request(url, init);
      if (request.headers.get(CALLER_RESULT_FEEDBACK_HEADER) !== token) fail("http_header_missing");
      return new Response(JSON.stringify({
        ok: true,
        accepted: true,
        bound: false,
        charged: false,
        payerIdentity: false,
        usefulness: "unknown",
        disposition: "useful",
        reasonCategory: "matched_task",
        coverage: "this_retained_result_only",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  if (reported.accepted !== true || reported.bound !== false || Object.hasOwn(reported, "parent")) {
    fail("http_accepted_bound");
  }
  if (result.delivered !== true) fail("http_delivery_lost");
  if (posts.length !== 1 || posts[0] !== `https://agents.samedaydesk.com${CALLER_RESULT_FEEDBACK_PATH}`) {
    fail("http_origin");
  }
  const httpOrigin = {};
  bindCallerResultFeedback(httpOrigin, {
    response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: token } }),
    resourceUrl: "http://127.0.0.1/extract",
  });
  const refusedOrigin = await reportCallerResult(httpOrigin, { disposition: "useful" });
  if (refusedOrigin.code !== "untrusted_origin") fail("http_origin_accepted");
  const malformed = {};
  bindCallerResultFeedback(malformed, {
    response: new Response(null, { headers: { [CALLER_RESULT_FEEDBACK_HEADER]: "not a token" } }),
    resourceUrl: "https://agents.samedaydesk.com/extract",
  });
  const refusedMalformed = await reportCallerResult(malformed, { disposition: "useful" });
  if (refusedMalformed.code !== "malformed_capability") fail("http_malformed_accepted");
  return {
    accepted: reported.accepted,
    bound: reported.bound,
    originRefused: refusedOrigin.code,
    malformed: refusedMalformed.code,
  };
}

async function localRefusals() {
  const contract = mcpCallerResultFeedbackPublicContract();
  const token = remember(`${"m".repeat(24)}.${"m".repeat(43)}`);
  const link = readMcpCallerResultCapability({
    _meta: { "samedaydesk/mcp-caller-result": { ...contract, token, link: "https://evil.example/pay" } },
  });
  const foreign = readMcpCallerResultCapability({
    _meta: { "samedaydesk/mcp-caller-result": { ...contract, token, tool: "extract" } },
  });
  const absent = readMcpCallerResultCapability({ content: [{ type: "text", text: "{}" }] });
  if (link.reason !== "unbounded_field") fail("link_not_refused");
  if (foreign.reason !== "contract_rejected") fail("foreign_tool_not_refused");
  if (absent.reason !== "absent") fail("absent_not_refused");
  const malformed = await reportMcpCallerResult({
    async callTool() { fail("malformed_reached_transport"); },
  }, { token: "short", disposition: "useful" });
  if (malformed.code !== "malformed_capability") fail("malformed_not_refused");
  return {
    link: link.reason,
    foreignTool: foreign.reason,
    absent: absent.reason,
    malformed: malformed.code,
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) fail("input_required");
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const http = await httpSelfCheck();
  const local = await localRefusals();
  const session = await openCaller(input.mcpUrl);
  let paymentCalls = 0;
  const originalCall = session.wrapped.callTool.bind(session.wrapped);
  session.wrapped.callTool = async (...args) => {
    if (args[0] === "report_caller_result") paymentCalls += 1;
    return originalCall(...args);
  };

  const first = await session.caller.pay("morpho_position", input.morpho);
  const second = await session.caller.pay("morpho_position", input.morpho);
  const skipped = await session.caller.pay("morpho_position", input.morpho);
  if (!first.capability?.present || !second.capability?.present) fail("capability_absent");
  if (first.capability.token === second.capability.token) fail("capability_crossover");
  if (first.returnedCapability !== false || second.returnedCapability !== false) fail("wrapper_returned_capability");
  remember(first.capability.token);
  remember(second.capability.token);
  remember(skipped.capability?.token);
  const delivered = JSON.stringify(first.content);

  let probe = "probe_succeeded";
  try {
    await session.caller.pay("opportunity_preflight", input.preflight);
  } catch (error) {
    probe = error?.code === -32602 ? "output_schema_rejected_challenge" : "probe_failed";
  }
  if (probe !== "output_schema_rejected_challenge") fail("schema_probe");
  const accepted = await challengeFor(input.mcpUrl, "opportunity_preflight", input.preflight);
  const preflightPayment = syntheticPayment({ accepts: accepted ? [accepted] : [] });
  if (!preflightPayment) fail("preflight_challenge");
  const preflight = await session.caller.payWithPayment("opportunity_preflight", input.preflight, preflightPayment);
  if (preflight.paymentMade !== true || preflight.capability.present !== false) fail("preflight_capability");

  const useful = await session.caller.report({
    token: first.capability.token,
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  const notUseful = await session.caller.report({
    token: second.capability.token,
    disposition: "not_useful",
    reasonCategory: "missing_field",
  });
  if (!independent(useful) || !independent(notUseful)) fail("pending_bound");
  if (JSON.stringify(first.content) !== delivered) fail("delivery_lost");
  if (paymentCalls !== 0) fail("report_used_payment_path");

  const tamperedToken = remember(`${first.capability.token.slice(0, first.capability.token.indexOf(".") + 1)}${first.capability.token[first.capability.token.indexOf(".") + 1] === "A" ? "B" : "A"}${first.capability.token.slice(first.capability.token.indexOf(".") + 2)}`);
  const tampered = await session.caller.report({ token: tamperedToken, disposition: "useful" });
  const expired = await session.caller.report({ token: remember(input.refusals.expired), disposition: "useful" });
  const foreignTool = await session.caller.report({ token: remember(input.refusals.foreignTool), disposition: "useful" });
  const httpChannel = await session.caller.report({ token: remember(input.refusals.httpChannel), disposition: "useful" });
  const dead = await reportMcpCallerResult({
    onAfterPayment() {},
    client: {
      async callTool() {
        const sdk = new Client({ name: "dead", version: "0" });
        await sdk.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${input.deadPort}/mcp`)));
        return sdk.callTool({ name: "report_caller_result", arguments: { token: first.capability.token, disposition: "useful" } });
      },
    },
  }, { token: first.capability.token, disposition: "useful" });
  if (JSON.stringify(first.content) !== delivered) fail("delivery_lost_after_refusal");

  await writeFile(`${input.signalDir}/captured`, JSON.stringify({
    purchases: 4,
    reported: 2,
    skipped: 1,
  }));
  await waitForFile(`${input.signalDir}/parent-ready`);
  const usefulBound = await session.caller.report({
    token: first.capability.token,
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  const notUsefulBound = await session.caller.report({
    token: second.capability.token,
    disposition: "not_useful",
    reasonCategory: "missing_field",
  });
  if (usefulBound.bound !== true || usefulBound.parent !== "bound" || usefulBound.idempotentReplay !== true) fail("useful_not_bound");
  if (notUsefulBound.bound !== true || notUsefulBound.parent !== "bound" || notUsefulBound.idempotentReplay !== true) fail("not_useful_not_bound");
  if (usefulBound.accepted !== true) fail("bound_not_accepted");
  await session.sdk.close().catch(() => {});
  await writeFile(`${input.signalDir}/bound`, "ok");
  await waitForFile(`${input.signalDir}/restart-ready`);
  const restartNote = await readFile(`${input.signalDir}/restart-ready`, "utf8");
  let restartUrl = input.mcpUrl;
  try {
    const parsed = JSON.parse(restartNote);
    if (typeof parsed?.mcpUrl === "string" && parsed.mcpUrl.length > 0) restartUrl = parsed.mcpUrl;
  } catch {
    restartUrl = input.mcpUrl;
  }
  const resumed = await openCaller(restartUrl);
  const restarted = await resumed.caller.report({
    token: first.capability.token,
    disposition: "useful",
    reasonCategory: "matched_task",
  });
  if (restarted.bound !== true || restarted.idempotentReplay !== true || restarted.parent !== "bound") fail("restart_replay");
  await resumed.sdk.close().catch(() => {});

  const summary = {
    outcome: "ready_for_receiving",
    walletInitialized: false,
    purchases: 4,
    reported: 2,
    skipped: skipped.paymentMade === true && skipped.capability?.present === true,
    paymentPathCalls: paymentCalls,
    wrapperReturnedCapability: false,
    outputSchemaProbe: probe,
    preflightCapability: false,
    usefulPending: independent(useful),
    usefulBound: usefulBound.bound === true,
    notUsefulBound: notUsefulBound.bound === true,
    restartReplay: restarted.idempotentReplay === true,
    contentPreserved: JSON.stringify(first.content) === delivered,
    http,
    refusals: {
      ...local,
      tampered: tampered.code,
      expired: expired.code,
      foreignToolServer: foreignTool.code,
      httpChannel: httpChannel.code,
      transport: dead.code,
    },
  };
  const encoded = JSON.stringify(summary);
  if (secrets.some((secret) => encoded.includes(secret)) || encoded.includes("http://") || encoded.includes("https://")) {
    fail("summary_leaked");
  }
  process.stdout.write(`${encoded}\n`);
}

main().catch((error) => {
  const code = error?.code || error?.message || "consumer_failed";
  process.stderr.write(`${code}\n`);
  process.exit(1);
});
