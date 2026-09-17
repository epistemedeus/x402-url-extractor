import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadSkillCatalog } from "./catalog.mjs";
import { createSkillsMcpServer, defaultSkillsServerInfo } from "./extension.mjs";

export const SKILLS_MCP_PATH = "/mcp";
export const SKILLS_MCP_JSON_LIMIT = "1mb";

export function mountSkillsMcp(app, {
  path = SKILLS_MCP_PATH,
  catalog,
  skillsRoot,
  names,
  serverInfo = defaultSkillsServerInfo(),
  pageSize,
  streamableHttpOptions = undefined,
} = {}) {
  const snapshot = catalog ?? loadSkillCatalog({ skillsRoot, names });
  const transportOptions = {
    enableJsonResponse: true,
    ...(streamableHttpOptions && typeof streamableHttpOptions === "object" ? streamableHttpOptions : {}),
    sessionIdGenerator: undefined,
  };

  const makeServer = () => createSkillsMcpServer(snapshot, { serverInfo, pageSize });

  app.post(path, express.json({ limit: SKILLS_MCP_JSON_LIMIT }), async (req, res) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport(transportOptions);
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

  const methodNotAllowed = (_req, res) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed: this MCP server is stateless; POST JSON-RPC to /mcp.",
      },
      id: null,
    });
  app.get(path, methodNotAllowed);
  app.delete(path, methodNotAllowed);

  return {
    path,
    catalog: snapshot,
    skillCount: snapshot.skills.length,
    serverInfo,
  };
}

export function decodeMcpJsonRpcBody(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payload = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("");
    return payload ? JSON.parse(payload) : null;
  }
  return JSON.parse(text);
}

export const SKILLS_MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

export function initializeParams(clientInfo = { name: "samedaydesk-skills-client", version: "1" }) {
  return {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo,
  };
}

export async function postSkillsJsonRpc(origin, body, { path = SKILLS_MCP_PATH, headers = {}, timeoutMs = 8_000 } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { ...SKILLS_MCP_HEADERS, ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    json: decodeMcpJsonRpcBody(buffer, response.headers.get("content-type")),
  };
}

export async function listenSkillsMcp({ host = "127.0.0.1", port = 0, ...mountOptions } = {}) {
  const app = express();
  const mounted = mountSkillsMcp(app, mountOptions);
  const server = app.listen(port, host);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const origin = `http://${host}:${address.port}`;
  return {
    ...mounted,
    origin,
    host,
    port: address.port,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
