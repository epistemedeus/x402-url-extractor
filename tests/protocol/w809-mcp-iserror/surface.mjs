import { createRequire } from "node:module";
import { z } from "zod";

import { mountMcp } from "../../../mcp-server.mjs";
import { SDS } from "./constants.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

export const SERVER_INFO = Object.freeze({
  name: SDS.serviceName,
  version: "test-w809-mcp-iserror",
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
      throw new Error("w809-mcp-iserror must not verify");
    },
    async settle() {
      calls.settle += 1;
      throw new Error("w809-mcp-iserror must not settle");
    },
  };
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

function decodeMcpBody(text, contentType) {
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payloads = String(text)
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .filter(Boolean);
    for (let index = payloads.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(payloads[index]);
      } catch {
        /* keep scanning */
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

  let server = null;
  try {
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

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    await mountMcp(app, {
      facilitatorClient: createFacilitator(calls),
      network: SDS.network,
      payTo: SDS.payTo,
      serverInfo: SERVER_INFO,
      streamableHttpOptions: { enableJsonResponse: true },
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
        return {
          status: response.status,
          json: decodeMcpBody(text, response.headers.get("content-type")),
          text,
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
