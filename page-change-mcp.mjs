// Stateless Streamable HTTP profile for the existing free page comparison.
// One tool, compare_page_observations. It calls the same admission and
// compare core as POST /recipes/page-change. It does not proxy through the
// paid /mcp catalog, fetch URLs, or take payment.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MCP_JSON_RPC_MAX_BYTES, mcpJsonRpcOverlimitBody } from "./mcp-json-rpc-limit.mjs";
import { pageChangeMcpDescription, pageChangeMcpInputSchema } from "./page-change-input-contract.mjs";
import {
  PAGE_CHANGE_HTTP_PRODUCT,
  PAGE_CHANGE_HTTP_SCHEMA,
  PageChangeHttpError,
  executePageChangeComparison,
  pageChangeHttpLimits,
} from "./page-change-http.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";

export const PAGE_CHANGE_MCP_PATH = "/mcp/page-change";
export const PAGE_CHANGE_MCP_TOOL = "compare_page_observations";
export const PAGE_CHANGE_MCP_SERVER_NAME = "samedaydesk-page-compare";
export const PAGE_CHANGE_MCP_INSTRUCTIONS = "Compare two JSON page observations the caller already holds. The only tool is compare_page_observations. Do not fetch URLs, extract remote pages, schedule a later observation, or take payment.";

// Pure supplied-JSON computation. No write, no deletion, no open-ended fetch.
export const PAGE_CHANGE_MCP_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

function isJsonContentType(req) {
  const type = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  return type === "application/json" || /^application\/[a-z0-9.+-]*\+json$/.test(type);
}

function toolText(body, isError) {
  const result = { content: [{ type: "text", text: JSON.stringify(body) }] };
  if (isError) result.isError = true;
  else if (body && typeof body === "object" && !Array.isArray(body)) result.structuredContent = body;
  return result;
}

function failureBody(error) {
  if (error instanceof PageChangeHttpError) {
    return {
      ok: false,
      product: PAGE_CHANGE_HTTP_PRODUCT,
      schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
      charged: false,
      error: error.code,
      message: String(error.message).slice(0, 160),
      code: error.code,
    };
  }
  return {
    ok: false,
    product: PAGE_CHANGE_HTTP_PRODUCT,
    schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
    charged: false,
    error: "page_change_http_failed",
    message: "page-change compare failed",
    code: "page_change_http_failed",
  };
}

function unknownToolError(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (body.jsonrpc !== "2.0" || body.method !== "tools/call") return null;
  if (!Object.hasOwn(body, "id")) return null;
  const name = body.params?.name;
  if (typeof name !== "string" || name.length === 0 || name === PAGE_CHANGE_MCP_TOOL) return null;
  return {
    jsonrpc: "2.0",
    id: body.id,
    error: { code: -32602, message: "Unknown tool" },
  };
}

function methodNotAllowed(_req, res) {
  res.set("Allow", "POST");
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  return res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: `Method not allowed: this MCP server is stateless; POST JSON-RPC to ${PAGE_CHANGE_MCP_PATH}.`,
    },
    id: null,
  });
}

/**
 * Mount the free page-comparison MCP profile on an existing Express app.
 * A fresh SDK server and transport handles each POST. GET returns 405 so a
 * probe does not look like a missing listener.
 *
 * @param {import("express").Express} app
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export function mountPageChangeMcp(app, { env = process.env } = {}) {
  const inputSchema = pageChangeMcpInputSchema();
  const description = pageChangeMcpDescription();
  const parser = express.json({
    limit: MCP_JSON_RPC_MAX_BYTES,
    type: ["application/json", "application/*+json"],
  });

  function parseJson(req, res, next) {
    parser(req, res, (error) => {
      if (!error) return next();
      res.set("Cache-Control", "no-store");
      res.set("X-Robots-Tag", "noindex, nofollow");
      if (error.type === "entity.too.large") return res.status(200).json(mcpJsonRpcOverlimitBody());
      if (error.type === "entity.parse.failed") {
        return res.status(400).json({
          ok: false,
          product: PAGE_CHANGE_HTTP_PRODUCT,
          schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
          charged: false,
          error: "invalid_json",
          code: "invalid_json",
        });
      }
      return next(error);
    });
  }

  async function compare(args) {
    const output = await executePageChangeComparison(args, env);
    if (output?.ok === true) {
      const limits = pageChangeHttpLimits(env);
      if (Buffer.byteLength(JSON.stringify(output), "utf8") > limits.maxOutputBytes) {
        throw new PageChangeHttpError("response exceeds server ceiling", { status: 413, code: "output_too_large" });
      }
    }
    const failed = !output || output.ok !== true || output.charged !== false;
    return toolText(output, failed);
  }

  app.post(PAGE_CHANGE_MCP_PATH, parseJson, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    if (!isJsonContentType(req)) {
      return res.status(415).json({
        ok: false,
        product: PAGE_CHANGE_HTTP_PRODUCT,
        schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
        charged: false,
        error: "unsupported_media_type",
        code: "unsupported_media_type",
      });
    }
    // Current MCP does not support JSON-RPC batches. Refuse the array before a
    // tool handler can run.
    if (Array.isArray(req.body)) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request" },
        id: null,
      });
    }
    const unknown = unknownToolError(req.body);
    if (unknown) return res.status(200).json(unknown);
    // Zod is discovery-only. Comparing its parsed copy reorders keys and
    // changes the admitted artifact hash. Admit the raw arguments instead.
    const suppliedArguments = req.body?.params?.arguments && typeof req.body.params.arguments === "object" && !Array.isArray(req.body.params.arguments)
      ? structuredClone(req.body.params.arguments)
      : undefined;
    const server = new McpServer({
      name: PAGE_CHANGE_MCP_SERVER_NAME,
      version: SERVICE_VERSION,
    }, {
      instructions: PAGE_CHANGE_MCP_INSTRUCTIONS,
    });
    server.registerTool(PAGE_CHANGE_MCP_TOOL, {
      title: "Compare page observations",
      description,
      inputSchema,
      annotations: PAGE_CHANGE_MCP_ANNOTATIONS,
      _meta: { samedaydesk: { charged: false, paymentRequired: false } },
    }, async () => {
      try {
        return await compare(suppliedArguments);
      } catch (error) {
        return toolText(failureBody(error), true);
      }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "page-change mcp failed" },
          id: req.body && typeof req.body === "object" && !Array.isArray(req.body) && Object.hasOwn(req.body, "id") ? req.body.id : null,
        });
      }
      transport.close().catch(() => {});
      server.close().catch(() => {});
    }
  });
  app.all(PAGE_CHANGE_MCP_PATH, methodNotAllowed);
  return { path: PAGE_CHANGE_MCP_PATH, tool: PAGE_CHANGE_MCP_TOOL };
}
