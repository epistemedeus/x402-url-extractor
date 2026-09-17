import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import { mountMcp } from "../../../mcp-server.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

export const NETWORK = "eip155:84532";
export const PAY_TO = "0x2000000000000000000000000000000000000002";
export const SERVER_INFO = Object.freeze({ name: "x402-negative-tools-call", version: "test" });
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

function snapshot(calls) {
  return { handler: calls.handler, verify: calls.verify, settle: calls.settle };
}

function delta(before, after) {
  return {
    handler: after.handler - before.handler,
    verify: after.verify - before.verify,
    settle: after.settle - before.settle,
  };
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function createFacilitator(calls) {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
    },
    async verify() {
      calls.verify += 1;
      return { isValid: false, invalidReason: "negative-tools-call-forged" };
    },
    async settle() {
      calls.settle += 1;
      throw new Error("negative tools/call fixtures must not settle");
    },
  };
}

export async function withNegativeMcpClient(fn) {
  const calls = { handler: 0, verify: 0, settle: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") {
      throw new Error(`external network blocked: ${url.origin}`);
    }
    return originalFetch(input, init);
  };

  const app = express();
  const tools = [{
    name: "extract",
    description: "synthetic paid extract for negative tools/call fixtures",
    price: "$0.01",
    inputSchema: { url: z.string().url() },
    run: async (args) => {
      calls.handler += 1;
      return { ok: true, url: args.url };
    },
  }];

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    await mountMcp(app, {
      facilitatorClient: createFacilitator(calls),
      network: NETWORK,
      payTo: PAY_TO,
      serverInfo: SERVER_INFO,
      streamableHttpOptions: { enableJsonResponse: true },
      tools,
    });

    const client = new Client({ name: "x402-negative-tools-call", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));

    const session = {
      origin,
      client,
      calls,
      snapshot: () => snapshot(calls),
      delta,
      async post(body) {
        const response = await fetch(`${origin}/mcp`, {
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8_000),
        });
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        return { status: response.status, json, text };
      },
    };

    try {
      return await fn(session);
    } finally {
      await client.close().catch(() => {});
    }
  } finally {
    globalThis.fetch = originalFetch;
    await closeServer(server);
  }
}
