import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { SERVER_INFO } from "./catalog.mjs";
import { decodeMcpBody, headerMap, requestHadPayment } from "./decode.mjs";
import { registerUnpaidResources } from "./register.mjs";

export const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

export const PROTOCOL_VERSION = "2025-11-25";

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

export function initializeBody(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "resources-list-unpaid", version: "1.0.0" },
    },
  };
}

export function resourcesListBody(id = 2, params = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method: "resources/list",
    params,
  };
}

export async function postMcp(origin, body, extraHeaders = {}) {
  const headers = { ...MCP_HEADERS, ...extraHeaders };
  const paymentSent = requestHadPayment(headers);
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");
  return {
    status: response.status,
    headers: headerMap(response.headers),
    json: decodeMcpBody(buffer, contentType),
    paymentSent,
  };
}

export function createUnpaidResourcesServer() {
  const server = new McpServer(SERVER_INFO);
  registerUnpaidResources(server);
  return server;
}

/**
 * Loopback streamable-HTTP MCP that only exposes the unpaid resources catalog.
 */
export async function startUnpaidResourcesMcp({ jsonResponse = true } = {}) {
  const app = express();
  app.post("/mcp", express.json({ limit: "256kb" }), async (req, res) => {
    const server = createUnpaidResourcesServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: jsonResponse,
    });
    res.on("close", () => {
      try { transport.close(); } catch { /* noop */ }
      try { server.close?.(); } catch { /* noop */ }
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: String(error?.message || error) },
          id: null,
        });
      }
    }
  });
  const httpServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const origin = `http://127.0.0.1:${httpServer.address().port}`;
  return {
    origin,
    async post(body, extraHeaders) {
      return postMcp(origin, body, extraHeaders);
    },
    async close() {
      await closeServer(httpServer);
    },
  };
}

export async function coldRun({ jsonResponse = true } = {}) {
  const mounted = await startUnpaidResourcesMcp({ jsonResponse });
  try {
    const initialized = await mounted.post(initializeBody());
    const listed = await mounted.post(resourcesListBody());
    return {
      origin: mounted.origin,
      initialized,
      listed,
    };
  } finally {
    await mounted.close();
  }
}
