#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, requireBaseUrl } from "../src/config.mjs";
import { listen } from "../src/listen.mjs";
import { createMcpServer } from "../src/mcp-server.mjs";

const config = loadConfig();
requireBaseUrl(config);
const server = createMcpServer(config);
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
await server.connect(transport);
const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "route_not_found" } }));
    return;
  }
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error(error?.code || "mcp_http_failed");
    if (!res.headersSent) res.writeHead(500).end();
  }
});
const url = await listen(httpServer, { port: config.port, urlFile: config.urlFile });
console.error(`AE20_D_MCP_HTTP ${url}/mcp`);
