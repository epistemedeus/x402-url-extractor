import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import { mountMcp } from "../../../mcp-server.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

const NETWORK = "eip155:84532";
const PAY_TO = "0x2000000000000000000000000000000000000002";
const PAYER = "0x1000000000000000000000000000000000000001";
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

function createFacilitator() {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
    },
    async verify() {
      return { isValid: true, payer: PAYER };
    },
    async settle() {
      throw new Error("prompts-list-unpaid harness must not settle");
    },
  };
}

function installLoopbackOnlyFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      throw new Error(`external network blocked: ${url.origin}`);
    }
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

export function decodeMcpBody(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payload = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .at(-1);
    return payload ? JSON.parse(payload) : null;
  }
  return JSON.parse(text);
}

export async function withMountedUnpaidPromptsSurface(fn) {
  const restoreFetch = installLoopbackOnlyFetch();
  const handlerCalls = { extract: 0 };
  const app = express();
  await mountMcp(app, {
    facilitatorClient: createFacilitator(),
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "x402-data-gateway", version: "prompts-list-unpaid" },
    tools: [
      {
        name: "extract",
        description: "fixture extract; unpaid prompts/list must not execute this handler",
        price: "$0.005",
        inputSchema: { url: z.string() },
        run: async () => {
          handlerCalls.extract += 1;
          throw new Error("unpaid prompts/list harness must not execute extract");
        },
      },
    ],
  });
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const origin = `http://127.0.0.1:${httpServer.address().port}`;
  const mcpUrl = new URL("/mcp", origin);

  async function postRaw(body, extraHeaders = {}) {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, ...extraHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers.entries());
    return {
      status: response.status,
      headers,
      json: decodeMcpBody(buffer, response.headers.get("content-type")),
    };
  }

  const client = new Client({ name: "prompts-list-unpaid", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(mcpUrl));
  try {
    return await fn({
      client,
      origin,
      mcpUrl: mcpUrl.href,
      handlerCalls,
      postRaw,
    });
  } finally {
    try {
      await client.close();
    } catch {
      /* already closed */
    }
    await closeServer(httpServer);
    restoreFetch();
  }
}
