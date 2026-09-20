import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LIVE_MCP_URL,
  MAX_BYTES,
  discoverLive,
  rejectSeededDocument,
  rejectSeededFixtures,
} from "./verify.mjs";

const VERIFY = fileURLToPath(new URL("./verify.mjs", import.meta.url));

const EXTRACT_OUTPUT_REQUIRED = [
  "ok", "requestedUrl", "finalUrl", "url", "status", "sourceOk", "error",
  "contentType", "title", "description", "canonical", "lang", "openGraph",
  "twitter", "jsonLd", "headings", "links", "text", "aiReadiness", "capture",
  "fetchedAt",
];

const EXTRACT_BATCH_OUTPUT_REQUIRED = [
  "ok", "product", "schemaVersion", "quote", "jobId", "jobStatus",
  "stopReason", "partial", "sources", "accounting", "costInputs", "charged",
  "boundary",
];

const EXTRACT = {
  name: "extract",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: { url: { type: "string" } },
  },
  outputSchema: { type: "object", required: EXTRACT_OUTPUT_REQUIRED },
};

const BATCH = {
  name: "extract_batch",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["urls"],
    properties: { urls: { type: "array", minItems: 1, maxItems: 5 } },
  },
  outputSchema: { type: "object", required: EXTRACT_BATCH_OUTPUT_REQUIRED },
};

const INIT_OK = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2025-11-25",
    serverInfo: { name: "x402-data-gateway", version: "1.23.49" },
  },
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sseResponse(body, headers = {}) {
  return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

function inventoryFor(id) {
  return { jsonrpc: "2.0", id, result: { tools: [EXTRACT, BATCH] } };
}

function mockMerchant(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("reject-seeded fixtures all fail with their expectReject reason", () => {
  const results = rejectSeededFixtures();
  assert.equal(results.length, 10);
  assert.equal(results.every((row) => row.rejected === true), true);
});

test("seeded HTTP 201 initialize is not unpaid discovery success", async () => {
  const fetchImpl = mockMerchant((_url, init) => {
    const rpc = JSON.parse(init.body);
    if (rpc.method === "initialize") return jsonResponse(INIT_OK, 201);
    return jsonResponse(inventoryFor(rpc.id));
  });
  await assert.rejects(() => discoverLive({ fetchImpl }), /initialize HTTP 201/);
  assert.equal(fetchImpl.calls.length, 1);
});

test("HTTP 402 on tools/list stops without paying", async () => {
  const fetchImpl = mockMerchant((_url, init) => {
    const rpc = JSON.parse(init.body);
    if (rpc.method === "initialize") return jsonResponse(INIT_OK);
    return jsonResponse({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "Payment required" } }, 402);
  });
  await assert.rejects(() => discoverLive({ fetchImpl }), /tools\/list HTTP 402/);
});

test("JSON-RPC error is not reported as a missing protocolVersion", async () => {
  const fetchImpl = mockMerchant(() => jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32600, message: "Invalid Request" },
  }));
  await assert.rejects(
    () => discoverLive({ fetchImpl }),
    { message: "initialize JSON-RPC error -32600: Invalid Request" },
  );
});

test("JSON-RPC id mismatch is rejected", async () => {
  const fetchImpl = mockMerchant(() => jsonResponse({ ...INIT_OK, id: 99 }));
  await assert.rejects(() => discoverLive({ fetchImpl }), /initialize JSON-RPC id mismatch/);
});

test("repeated tools/list nextCursor stops before the page ceiling", async () => {
  let toolsListCalls = 0;
  const fetchImpl = mockMerchant((_url, init) => {
    const rpc = JSON.parse(init.body);
    if (rpc.method === "initialize") return jsonResponse(INIT_OK);
    toolsListCalls += 1;
    return jsonResponse({
      jsonrpc: "2.0",
      id: rpc.id,
      result: { tools: toolsListCalls === 1 ? [EXTRACT] : [], nextCursor: "loop" },
    });
  });
  await assert.rejects(() => discoverLive({ fetchImpl }), /tools\/list repeated nextCursor/);
  assert.equal(toolsListCalls, 2);
});

test("Content-Length above the byte cap cancels the body", async () => {
  let cancelled = false;
  let pulled = false;
  const fetchImpl = mockMerchant(() => ({
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-length" ? String(MAX_BYTES + 1) : "application/json";
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            pulled = true;
            return { done: false, value: new Uint8Array(64 * 1024) };
          },
          async cancel() { cancelled = true; },
        };
      },
      async cancel() { cancelled = true; },
    },
  }));
  await assert.rejects(() => discoverLive({ fetchImpl }), /initialize response exceeded/);
  assert.equal(pulled, false);
  assert.equal(cancelled, true);
});

test("unbounded stream is capped well before the 15s fetch timeout", async () => {
  const started = Date.now();
  let pulls = 0;
  const fetchImpl = mockMerchant(() => {
    const stream = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(64 * 1024).fill(120));
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  });
  await assert.rejects(() => discoverLive({ fetchImpl }), /initialize response exceeded/);
  assert.ok(Date.now() - started < 2000, "byte cap must not wait for the fetch timeout");
  assert.ok(pulls <= 20);
});

test("live-shaped SSE initialize plus tools/list succeeds without payment headers", async () => {
  const fetchImpl = mockMerchant((_url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const headers = Object.fromEntries(
      Object.entries(init.headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    assert.equal(headers["mcp-method"], undefined);
    assert.equal(headers["payment-signature"], undefined);
    assert.equal(headers["x-payment"], undefined);
    assert.equal(headers.authorization, undefined);
    const rpc = JSON.parse(init.body);
    assert.notEqual(rpc.method, "tools/call");
    if (rpc.method === "initialize") return sseResponse(INIT_OK);
    return sseResponse(inventoryFor(rpc.id));
  });
  const report = await discoverLive({ fetchImpl });
  assert.equal(report.ok, true);
  assert.equal(report.extractPresent, true);
  assert.equal(report.extractBatchPresent, true);
  assert.equal(report.paymentAttempted, false);
  assert.equal(report.toolsCallAttempted, false);
  assert.equal(fetchImpl.calls[0].url, LIVE_MCP_URL);
  assert.equal(fetchImpl.calls.length, 2);
});

test("a complete inventory document is still rejected as a seeded fixture", () => {
  assert.throws(
    () => rejectSeededDocument({
      kind: "inventory",
      payload: { method: "tools/list", result: { tools: [EXTRACT, BATCH] } },
    }),
    { message: "seeded document was accepted as unpaid discovery" },
  );
});

test("publish argv is a kill and does not contact the merchant", () => {
  const result = spawnSync(process.execPath, [VERIFY, "publish"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /KILL: publish\/registry is out of scope for MCP unpaid discovery/);
  assert.equal(JSON.parse(result.stdout).killed, true);
});
