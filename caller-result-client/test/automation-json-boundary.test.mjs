import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { x402MCPClient } from "@x402/mcp";
import { z } from "zod";

import { bindPaidMcpCallerResult, reportMcpCallerResult } from "../src/mcp-caller-result.mjs";
import {
  EVIDENCE_KEY,
  MAX_RECEIPT_BYTES,
  classifyStore,
  evidenceOf,
  outcomeClass,
  readReceipt,
  remember,
} from "./automation-json-boundary.mjs";

const MIXED = Object.freeze({
  amount: "0",
  unit: "USDC",
  count: 0,
  note: "",
  label: null,
  ok: true,
});

function evidence(callId, taskId) {
  return { [EVIDENCE_KEY]: { callId, taskId, evidenceId: `ev-${callId}` } };
}

function observation(caseId) {
  if (caseId === "mixed") {
    return {
      content: [
        { type: "text", text: "retained text" },
        { type: "text", text: JSON.stringify(MIXED) },
      ],
      structuredContent: { ...MIXED },
      isError: false,
      _meta: evidence("call-mixed", "task-a"),
    };
  }
  if (caseId === "refusal") {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, verdict: "changed" }) }],
      structuredContent: { ok: false, code: "not_actionable", usefulness: "unknown" },
      isError: true,
      _meta: evidence("call-refuse", "task-a"),
    };
  }
  if (caseId === "absent") {
    return {
      content: [{ type: "text", text: "{}" }],
      structuredContent: { amount: "1", unit: "USDC" },
      isError: false,
      _meta: evidence("call-absent", "task-b"),
    };
  }
  if (caseId === "other") {
    return {
      content: [{ type: "text", text: "other task" }],
      structuredContent: { amount: "2", unit: "USDC", count: 1, note: "kept", label: "x", ok: true },
      isError: false,
      _meta: evidence("call-other", "task-b"),
    };
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sessionServer(calls) {
  const mcp = new McpServer({ name: "interop-211965", version: "0" });
  mcp.registerTool("observe", {
    description: "Synthetic read-only observation",
    inputSchema: { caseId: z.string() },
  }, async ({ caseId }) => {
    calls.push({ tool: "observe", caseId });
    const result = observation(caseId);
    if (!result) {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ ok: false, code: "unknown_case" }) }],
      };
    }
    return result;
  });
  mcp.registerTool("report_caller_result", {
    description: "Synthetic feedback refusal",
    inputSchema: {
      token: z.string(),
      disposition: z.string(),
      reasonCategory: z.string().optional(),
    },
  }, async () => {
    calls.push({ tool: "report_caller_result" });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          accepted: false,
          bound: false,
          charged: false,
          payerIdentity: false,
          usefulness: "unknown",
          code: "not_actionable",
          disposition: null,
          reasonCategory: null,
          idempotentReplay: false,
          parent: null,
          retainedDisposition: null,
          retainedReasonCategory: null,
          coverage: null,
        }),
      }],
      isError: false,
    };
  });
  return mcp;
}

async function listen() {
  const transports = new Map();
  const calls = [];
  const http = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    try {
      const sessionHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      const body = req.method === "POST" ? await readBody(req) : undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport && req.method === "POST" && !sessionId && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => transports.set(id, transport),
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        await sessionServer(calls).connect(transport);
      }
      if (!transport) {
        res.writeHead(400).end();
        return;
      }
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise((resolve) => http.close(resolve)),
  };
}

test("a JSON receipt rejects malformed, unsafe, and non-object payloads", () => {
  assert.equal(readReceipt("{").code, "malformed_json");
  assert.equal(readReceipt('{"ok":true').code, "malformed_json");
  assert.equal(readReceipt(`{"pad":"${"a".repeat(MAX_RECEIPT_BYTES)}"}`).code, "oversized");
  assert.equal(readReceipt("[]").code, "unsupported_shape");
  assert.equal(readReceipt("null").code, "unsupported_shape");
  const before = Object.prototype.polluted;
  const unsafe = readReceipt('{"__proto__":{"polluted":true},"isError":false,"content":[]}');
  assert.equal(unsafe.code, "unsafe_key");
  assert.equal(Object.prototype.polluted, before);
  assert.equal(readReceipt('{"constructor":{"prototype":{"polluted":true}},"content":[]}').code, "unsafe_key");
  const zero = readReceipt(JSON.stringify({
    records: {
      "call-zero": {
        result: {
          content: [{ type: "text", text: "zero" }],
          structuredContent: { amount: "0", unit: "USDC", count: 0, note: "", label: null },
          isError: false,
          _meta: evidence("call-zero", "task-a"),
        },
      },
    },
  }));
  assert.equal(zero.ok, true);
  assert.equal(zero.receipt.records["call-zero"].result.structuredContent.amount, "0");
  assert.equal(zero.receipt.records["call-zero"].result.structuredContent.count, 0);
  assert.equal(zero.receipt.records["call-zero"].result.structuredContent.note, "");
  assert.equal(zero.receipt.records["call-zero"].result.structuredContent.label, null);
  assert.equal(Object.hasOwn(zero.receipt.records["call-zero"].result.structuredContent, "missing"), false);
});

test("direct HTTP and the SDK keep result, refusal, and evidence across a JSON file", async () => {
  const server = await listen();
  const directory = await mkdtemp(join(tmpdir(), "interop-211965-"));
  const file = join(directory, "receipts.json");
  const timings = {};
  let paymentReads = 0;
  try {
    const sdkStarted = performance.now();
    const sdk = new Client({ name: "direct", version: "0" });
    await sdk.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    const direct = {};
    for (const caseId of ["mixed", "refusal", "absent", "other"]) {
      direct[caseId] = await sdk.callTool({ name: "observe", arguments: { caseId } });
    }
    let protocolError = null;
    let unknownResult = null;
    try {
      unknownResult = await sdk.callTool({ name: "missing_tool", arguments: {} }, undefined, { timeout: 2000 });
    } catch (error) {
      protocolError = error;
    }
    timings.sdkMs = performance.now() - sdkStarted;
    if (protocolError) assert.equal(protocolError.code, -32602);
    if (unknownResult) {
      assert.equal(unknownResult.isError, true);
      assert.equal(outcomeClass(unknownResult), "tool_refusal");
      assert.equal(unknownResult.content[0].text.includes("missing_tool"), true);
    }
    assert.equal(Boolean(protocolError) || Boolean(unknownResult), true);
    assert.equal(outcomeClass({ protocolError: true }), "protocol_error");
    assert.notEqual(outcomeClass(direct.refusal), "useful");
    assert.deepEqual(direct.mixed.structuredContent, MIXED);
    assert.equal(direct.mixed.content[0].text, "retained text");
    assert.equal(evidenceOf(direct.mixed).callId, "call-mixed");
    assert.equal(JSON.parse(direct.refusal.content[0].text).ok, true);
    assert.equal(outcomeClass(direct.refusal), "tool_refusal");
    assert.equal(direct.refusal.structuredContent.ok, false);
    const httpRoundTrip = JSON.parse(JSON.stringify(direct.mixed));
    assert.deepEqual(httpRoundTrip.structuredContent, direct.mixed.structuredContent);
    assert.equal(evidenceOf(httpRoundTrip).evidenceId, evidenceOf(direct.mixed).evidenceId);
    assert.equal(Object.hasOwn(direct.absent.structuredContent, "note"), false);
    assert.equal(direct.absent.structuredContent.amount, "1");

    const closed = server.url.replace(/:\d+\//, ":1/");
    const transportStarted = performance.now();
    let transportCode = "";
    try {
      await fetch(closed, { method: "POST", body: "{}", signal: AbortSignal.timeout(300) });
      transportCode = "opened";
    } catch (error) {
      transportCode = error.name;
    }
    timings.transportMs = performance.now() - transportStarted;
    assert.notEqual(transportCode, "opened");
    assert.equal(outcomeClass({ transport: "failed" }), "transport_failure");
    assert.notEqual(outcomeClass({ transport: "failed" }), outcomeClass(direct.refusal));

    const index = {};
    for (const caseId of ["mixed", "refusal", "absent", "other"]) {
      const record = { source: "sdk", result: direct[caseId] };
      const saved = remember(index, record);
      assert.equal(saved.stored, true, caseId);
    }
    const duplicate = remember(index, { source: "sdk", result: direct.mixed });
    assert.equal(duplicate.code, "duplicate_receipt");
    assert.equal(duplicate.kept.result.isError, false);
    assert.equal(index["call-mixed"].result.content[0].text, "retained text");
    assert.equal(index["call-refuse"].result.isError, true);
    assert.equal(index["call-other"].result.structuredContent.amount, "2");
    const missingEvidence = remember(index, { source: "sdk", result: { content: [], isError: false } });
    assert.equal(missingEvidence.code, "evidence_absent");

    const callerStarted = performance.now();
    const paymentClient = new Proxy({}, {
      get(_target, prop) {
        paymentReads += 1;
        throw new Error(`payment_client_used:${String(prop)}`);
      },
    });
    const caller = bindPaidMcpCallerResult(new x402MCPClient(sdk, paymentClient, { autoPayment: false }));
    const callerMixed = await caller.pay("observe", { caseId: "mixed" });
    const callerRefusal = await caller.pay("observe", { caseId: "refusal" });
    timings.callerMs = performance.now() - callerStarted;
    assert.equal(paymentReads, 0);
    assert.equal(callerMixed.isError, false);
    assert.equal(callerMixed.paymentMade, false);
    assert.equal(callerMixed.capability.present, false);
    assert.equal(callerMixed.content[0].text, "retained text");
    assert.equal(Object.hasOwn(callerMixed, "structuredContent"), false);
    assert.equal(evidenceOf(callerMixed), null);
    assert.equal(callerRefusal.isError, true);
    assert.equal(outcomeClass(callerRefusal), "tool_refusal");
    assert.equal(JSON.parse(callerRefusal.content[0].text).ok, true);
    assert.equal(outcomeClass(callerRefusal), outcomeClass(direct.refusal));

    const storedBeforeReport = JSON.stringify({ schema: "samedaydesk.automation-json-boundary.v1", records: index });
    const token = `${"a".repeat(24)}.${"a".repeat(43)}`;
    const reportCallsBefore = server.calls.filter((call) => call.tool === "report_caller_result").length;
    const localRefusal = await reportMcpCallerResult(sdk, { token, disposition: "maybe" });
    assert.equal(localRefusal.code, "disposition_rejected");
    assert.equal(server.calls.filter((call) => call.tool === "report_caller_result").length, reportCallsBefore);
    const remoteRefusal = await caller.report({ token, disposition: "not_useful", reasonCategory: "not_actionable" });
    assert.equal(remoteRefusal.accepted, false);
    assert.equal(remoteRefusal.code, "not_actionable");
    assert.equal(JSON.stringify(remoteRefusal).includes(token), false);
    assert.equal(JSON.stringify({ schema: "samedaydesk.automation-json-boundary.v1", records: index }), storedBeforeReport);

    await writeFile(file, `${storedBeforeReport}\n`);
    const restartStarted = performance.now();
    const restarted = spawnSync(process.execPath, [
      join(import.meta.dirname, "automation-json-boundary.mjs"),
      file,
    ], { encoding: "utf8" });
    timings.restartMs = performance.now() - restartStarted;
    assert.equal(restarted.status, 0, restarted.stderr);
    const child = JSON.parse(restarted.stdout);
    assert.equal(child["call-mixed"].class, "useful");
    assert.equal(child["call-mixed"].associated, true);
    assert.equal(child["call-mixed"].taskId, "task-a");
    assert.equal(child["call-refuse"].class, "tool_refusal");
    assert.equal(child["call-refuse"].associated, true);
    assert.equal(child["call-refuse"].taskId, "task-a");
    assert.equal(child["call-absent"].class, "useful");
    assert.equal(child["call-absent"].taskId, "task-b");
    assert.equal(child["call-other"].taskId, "task-b");
    assert.notEqual(child["call-mixed"].evidenceCallId, child["call-other"].evidenceCallId);
    const reread = classifyStore(await readFile(file, "utf8"));
    assert.deepEqual(reread.classes, child);
    const storedAbsent = JSON.parse(await readFile(file, "utf8")).records["call-absent"].result.structuredContent;
    assert.equal(Object.hasOwn(storedAbsent, "note"), false);
    assert.equal(storedAbsent.amount, "1");
    console.log(`INTEROP_TIMING ${JSON.stringify({
      node: process.version,
      paymentReads,
      sdkMs: Number(timings.sdkMs.toFixed(3)),
      callerMs: Number(timings.callerMs.toFixed(3)),
      transportMs: Number(timings.transportMs.toFixed(3)),
      restartMs: Number(timings.restartMs.toFixed(3)),
      transportCode,
      observeCalls: server.calls.filter((call) => call.tool === "observe").length,
      reportCalls: server.calls.filter((call) => call.tool === "report_caller_result").length,
    })}`);
    await sdk.close();
  } finally {
    await server.close();
  }
});
