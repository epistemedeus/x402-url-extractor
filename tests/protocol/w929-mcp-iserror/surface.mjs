import { createRequire } from "node:module";
import { z } from "zod";

import { mountMcp } from "../../../mcp-server.mjs";
import { SDS } from "./constants.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

export const SERVER_INFO = Object.freeze({
  name: SDS.serviceName,
  version: "test-w929-mcp-iserror",
});

const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

function snapshot(calls) {
  return { handler: calls.handler, verify: calls.verify, settle: calls.settle };
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function createFacilitator(calls) {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: SDS.network }], extensions: [] };
    },
    async verify() {
      calls.verify += 1;
      throw new Error("w929-mcp-iserror must not verify");
    },
    async settle() {
      calls.settle += 1;
      throw new Error("w929-mcp-iserror must not settle");
    },
  };
}

function decodeMcpBody(text, contentType) {
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payload = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("");
    if (!payload) return null;
    return JSON.parse(payload);
  }
  return JSON.parse(text);
}

function headerObservation(response) {
  const headers = {};
  const headerNames = [];
  for (const [key, value] of response.headers.entries()) {
    const name = String(key).toLowerCase();
    headerNames.push(name);
    headers[name] = value;
  }
  return {
    headers,
    headerNames,
    hasPaymentRequiredHeader: headerNames.includes("payment-required"),
  };
}

export async function withUnpaidMcpSurface(fn) {
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
    name: SDS.mcpTool,
    description: "Fetch a public HTTP(S) page and return compact extraction signals.",
    price: SDS.price,
    inputSchema: { url: z.string() },
    tags: ["web", "extract"],
    run: async (args) => {
      calls.handler += 1;
      return { ok: true, url: args.url, charged: true };
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
      network: SDS.network,
      payTo: SDS.payTo,
      serverInfo: SERVER_INFO,
      tools,
    });

    const session = {
      origin,
      calls,
      snapshot: () => snapshot(calls),
      async post(body) {
        const response = await fetch(`${origin}/mcp`, {
          method: "POST",
          headers: MCP_HEADERS,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8_000),
        });
        const text = await response.text();
        const contentType = response.headers.get("content-type");
        let json = null;
        try {
          json = decodeMcpBody(text, contentType);
        } catch {
          json = null;
        }
        return {
          status: response.status,
          json,
          text,
          contentType,
          ...headerObservation(response),
        };
      },
    };

    return await fn(session);
  } finally {
    globalThis.fetch = originalFetch;
    await closeServer(server);
  }
}
