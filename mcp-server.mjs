// mcp-server.mjs — a PAID MCP server (streamable-HTTP) that exposes the same tools
// as our HTTP x402 routes, gated by x402, so MCP-enabled agent clients (Claude
// Desktop, Cursor, Windsurf, etc.) can discover them via `tools/list` (free) and
// pay-per-call via `tools/call` (x402). This reaches a buyer pool the HTTP/x402scan/
// Bazaar channels don't: agents wired through MCP.
//
// Design:
//  - Self-contained + mountable: `mountMcp(app, { facilitatorClient, network, payTo,
//    serverInfo, tools })`. server.js owns the price constants + tool handlers; this
//    module is generic. Reuses the SAME facilitator (CDP) -> USDC settles to OUR payTo.
//  - `tools/list` is FREE (protocol-level discovery). `tools/call` is x402-gated by
//    @x402/mcp's createPaymentWrapper: a call without payment returns a JSON-RPC
//    error (-32042, SEP-1036) carrying the x402 PaymentRequired in error.data; a call
//    WITH a signed payment in _meta["x402/payment"] is verified, executed, and settled.
//  - STATELESS streamable-HTTP: a fresh McpServer + transport per POST /mcp request
//    (sessionIdGenerator: undefined). The expensive async setup (resourceServer
//    initialize + buildPaymentRequirements per tool) is done ONCE at mount time.
//  - express.json() is scoped to /mcp only, so it never touches the GET paywall routes.
//
// Verified against @x402/mcp@2.16.0 + @modelcontextprotocol/sdk@1.29.0 (June 2026).

import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper } from "@x402/mcp";

// Turn a tool's raw result object into an MCP tool result. Errors are returned as a
// clean structured ok:false payload (not thrown) so the caller always gets legible JSON.
function asToolResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

/**
 * Mount a paid MCP server at POST /mcp on an existing Express app.
 *
 * @param {import('express').Express} app
 * @param {object} cfg
 * @param {object} cfg.facilitatorClient - the SAME HTTPFacilitatorClient server.js uses (CDP)
 * @param {string} cfg.network          - CAIP-2, e.g. "eip155:8453"
 * @param {string} cfg.payTo            - our wallet; USDC settles here
 * @param {{name:string,version:string}} cfg.serverInfo
 * @param {Array<{name:string,description:string,price:string,inputSchema:Record<string,z.ZodTypeAny>,run:(args:any)=>Promise<any>,tags?:string[]}>} cfg.tools
 * @returns {Promise<{toolCount:number}>}
 */
export async function mountMcp(app, { facilitatorClient, network, payTo, serverInfo, tools }) {
  // Dedicated resource server for MCP, sharing the facilitator with the HTTP routes.
  const resourceServer = new x402ResourceServer(facilitatorClient).register(network, new ExactEvmScheme());
  await resourceServer.initialize();

  // Pre-build the paid wrapper for each tool ONCE (buildPaymentRequirements is async).
  const prepared = [];
  for (const t of tools) {
    const accepts = await resourceServer.buildPaymentRequirements({
      scheme: "exact",
      network,
      payTo,
      price: t.price,
    });
    const paid = createPaymentWrapper(resourceServer, {
      accepts,
      resource: {
        url: `mcp://tool/${t.name}`,
        description: t.description,
        mimeType: "application/json",
        serviceName: serverInfo.name,
        tags: t.tags,
      },
    });
    // paid(handler) -> MCP tool callback (args, extra) that verifies payment (from
    // extra._meta), runs the handler, then settles. We catch handler errors and return
    // a structured ok:false so a paid call never yields an opaque failure.
    const handler = paid(async (args) => {
      try {
        return asToolResult(await t.run(args));
      } catch (e) {
        return { ...asToolResult({ ok: false, error: String(e?.message || e) }), isError: true };
      }
    });
    prepared.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, handler });
  }

  // A fresh MCP server per request (stateless mode requires server+transport per call).
  const makeServer = () => {
    const server = new McpServer(serverInfo);
    for (const t of prepared) {
      server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.handler);
    }
    return server;
  };

  // Stateless streamable-HTTP transport. express.json() scoped to this route only.
  app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      try { transport.close(); } catch { /* noop */ }
      try { server.close?.(); } catch { /* noop */ }
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: String(e?.message || e) }, id: null });
      }
    }
  });

  // Stateless server: no standalone GET (SSE) or DELETE (session teardown) support.
  const methodNotAllowed = (_req, res) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this MCP server is stateless; POST JSON-RPC to /mcp." }, id: null });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return { toolCount: prepared.length };
}
