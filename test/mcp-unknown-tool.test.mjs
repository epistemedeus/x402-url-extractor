import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { z } from "zod";

import { mountMcp, withoutSuccessShapedStructuredContent } from "../mcp-server.mjs";

const NETWORK = "eip155:84532";
const PAY_TO = "0x2000000000000000000000000000000000000002";

function facilitator() {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
    },
    async verify() {
      return { isValid: false };
    },
    async settle() {
      throw new Error("settle must not run");
    },
  };
}

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function post(origin, body) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).at(-1);
  const raw = dataLine ? dataLine.replace(/^data:\s?/, "") : text;
  return {
    status: response.status,
    www: response.headers.get("www-authenticate"),
    json: raw ? JSON.parse(raw) : null,
  };
}

test("success-shaped structuredContent is removed from an isError result", () => {
  const stripped = withoutSuccessShapedStructuredContent({
    isError: true,
    structuredContent: { ok: true, report: { verdict: "changed" } },
    content: [{ type: "text", text: "{\"ok\":true}" }],
  });
  assert.equal(stripped.structuredContent, undefined);
  assert.equal(JSON.parse(stripped.content[0].text).ok, false);
  const challenge = withoutSuccessShapedStructuredContent({
    isError: true,
    structuredContent: { x402Version: 2, accepts: [{ amount: "5000" }] },
    content: [{ type: "text", text: "challenge" }],
  });
  assert.equal(challenge.structuredContent.x402Version, 2);
});

test("unknown tool is JSON-RPC -32602 and a thrown tool stays isError", async () => {
  const app = express();
  await mountMcp(app, {
    facilitatorClient: facilitator(),
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "mer-pack-test", version: "0" },
    tools: [{
      name: "extract",
      description: "synthetic extract",
      price: "$0.005",
      inputSchema: { url: z.string() },
      run: async () => {
        throw new Error("synthetic-tool-failure");
      },
    }, {
      name: "page_change",
      free: true,
      description: "free compare",
      price: "$0",
      inputSchema: {
        before: z.record(z.string(), z.any()),
        after: z.record(z.string(), z.any()),
        fields: z.array(z.string()),
      },
      run: async () => {
        throw new Error("compare-failed");
      },
    }],
  });
  const server = await listen(app);
  try {
    const unknown = await post(server.origin, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "__r0923_absent_tool__", arguments: {} },
    });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.www, null);
    assert.equal(unknown.json.error.code, -32602);
    assert.equal(unknown.json.result, undefined);

    const challenged = await post(server.origin, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "extract", arguments: { url: "https://example.com" } },
    });
    assert.equal(challenged.json.error, undefined);
    assert.equal(challenged.json.result.isError, true);
    assert.equal(challenged.json.result.structuredContent.x402Version, 2);

    const failed = await post(server.origin, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "page_change", arguments: { before: { a: 1 }, after: { a: 2 }, fields: ["title"] } },
    });
    assert.equal(failed.json.error, undefined);
    assert.equal(failed.json.result.isError, true);
    assert.equal(failed.json.result.structuredContent, undefined);
    assert.equal(JSON.parse(failed.json.result.content[0].text).ok, false);
  } finally {
    await server.close();
  }
});
