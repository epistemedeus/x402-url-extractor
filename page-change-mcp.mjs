// Stateless Streamable HTTP profile for the existing free page comparison.
// One tool, compare_page_observations. It calls the same admission and
// compare core as POST /recipes/page-change. It does not proxy through the
// paid /mcp catalog, fetch URLs, or take payment.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { pageChangeMcpDescription, pageChangeMcpInputSchema } from "./page-change-input-contract.mjs";
import {
  PAGE_CHANGE_HTTP_PRODUCT,
  PAGE_CHANGE_HTTP_SCHEMA,
  PageChangeHttpError,
  assertPageChangeJsonDepth,
  beginPageChangeExchange,
  drainRequest,
  executePageChangeComparison,
  pageChangeHttpLimits,
  pageChangeServiceOutcome,
  parseBoundedJson,
  respondPageChangeError,
} from "./page-change-http.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";

export const PAGE_CHANGE_MCP_PATH = "/mcp/page-change";
export const PAGE_CHANGE_MCP_TOOL = "compare_page_observations";
export const PAGE_CHANGE_MCP_SERVER_NAME = "samedaydesk-page-compare";
export const PAGE_CHANGE_MCP_INSTRUCTIONS = "Compare two JSON page observations the caller already holds. The only tool is compare_page_observations. Do not fetch URLs, extract remote pages, schedule a later observation, or take payment.";

export function isPageChangeMcpPath(pathname) {
  const path = String(pathname || "").split("?", 1)[0].toLowerCase().replace(/\/+$/, "");
  return path === PAGE_CHANGE_MCP_PATH;
}

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

function boundedToolError(error) {
  if (error instanceof RangeError) {
    return new PageChangeHttpError("request json depth exceeds server limit", { status: 400, code: "json_depth_limit" });
  }
  return error;
}

/**
 * Mount the free page-comparison MCP profile on an existing Express app.
 * A fresh SDK server and transport handles each POST. GET returns 405 so a
 * probe does not look like a missing listener.
 *
 * The POST uses the same byte ceiling, active-upload slot, upload-plus-compare
 * deadline, and disconnect abort as POST /recipes/page-change. It does not use
 * that route's 12/IP/minute gate.
 *
 * @param {import("express").Express} app
 * @param {{ env?: NodeJS.ProcessEnv, observe?: Function | null }} [options]
 */
export function mountPageChangeMcp(app, { env = process.env, observe = null } = {}) {
  const inputSchema = pageChangeMcpInputSchema();
  const description = pageChangeMcpDescription();
  const limits = pageChangeHttpLimits(env);

  app.post(PAGE_CHANGE_MCP_PATH, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    let release = () => {};
    let note = () => {};
    let server = null;
    let transport = null;
    let rpcId = null;
    try {
      let subscribed = false;
      const ensureNote = () => {
        if (!subscribed) {
          subscribed = true;
          let record = () => {};
          try {
            if (typeof observe === "function") record = observe(req, res) || record;
          } catch { /* Optional measurement. */ }
          note = (outcome) => { try { record(outcome); } catch { /* Optional measurement. */ } };
        }
        return note;
      };
      if (!isJsonContentType(req)) {
        drainRequest(req, res);
        ensureNote();
        return res.status(415).json({
          ok: false,
          product: PAGE_CHANGE_HTTP_PRODUCT,
          schemaVersion: PAGE_CHANGE_HTTP_SCHEMA,
          charged: false,
          error: "unsupported_media_type",
          code: "unsupported_media_type",
        });
      }
      const exchange = beginPageChangeExchange(req, res, limits);
      if (!exchange.ok) {
        if (exchange.error.code === "page_change_busy") res.set("Retry-After", "1");
        ensureNote()(pageChangeServiceOutcome(null, exchange.error));
        return respondPageChangeError(res, exchange.error);
      }
      release = () => exchange.release();
      ensureNote();
      let parsed;
      try {
        parsed = parseBoundedJson(await exchange.read());
      } catch (error) {
        const bounded = boundedToolError(error);
        drainRequest(req, res);
        note(exchange.abort.signal.aborted ? "aborted" : pageChangeServiceOutcome(null, bounded));
        return respondPageChangeError(res, bounded);
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.hasOwn(parsed, "id")) rpcId = parsed.id;
      if (Array.isArray(parsed)) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Invalid Request" },
          id: null,
        });
      }
      const unknown = unknownToolError(parsed);
      if (unknown) return res.status(200).json(unknown);
      const journalCompare = parsed?.method === "tools/call";
      if (!journalCompare) note("omit");
      // Zod is discovery-only. Its copy reorders keys and changes the artifact
      // hash. Keep the parsed object itself. Cloning it walks the whole graph
      // and can throw RangeError before admission, outside this handler's catch.
      const suppliedArguments = parsed?.params?.arguments && typeof parsed.params.arguments === "object" && !Array.isArray(parsed.params.arguments)
        ? parsed.params.arguments
        : undefined;
      if (journalCompare && suppliedArguments) {
        try {
          if (suppliedArguments.before !== undefined) assertPageChangeJsonDepth(suppliedArguments.before, limits, "before");
          if (suppliedArguments.after !== undefined) assertPageChangeJsonDepth(suppliedArguments.after, limits, "after");
        } catch (error) {
          const bounded = boundedToolError(error);
          note(pageChangeServiceOutcome(null, bounded));
          return respondPageChangeError(res, bounded);
        }
      }
      server = new McpServer({
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
          const output = await executePageChangeComparison(suppliedArguments, env, {
            abortSignal: exchange.abort.signal,
            timeoutMs: exchange.remainingMs(),
          });
          if (output?.ok === true) {
            if (Buffer.byteLength(JSON.stringify(output), "utf8") > limits.maxOutputBytes) {
              throw new PageChangeHttpError("response exceeds server ceiling", { status: 413, code: "output_too_large" });
            }
          }
          const failed = !output || output.ok !== true || output.charged !== false;
          if (journalCompare) {
            note(exchange.abort.signal.aborted ? "aborted" : (failed ? "refused" : pageChangeServiceOutcome(output)));
          }
          return toolText(output, failed);
        } catch (error) {
          const bounded = boundedToolError(error);
          if (journalCompare) note(exchange.abort.signal.aborted ? "aborted" : pageChangeServiceOutcome(null, bounded));
          return toolText(failureBody(bounded), true);
        }
      });
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (error) {
      const bounded = boundedToolError(error);
      try { note(pageChangeServiceOutcome(null, bounded)); } catch { /* Optional measurement. */ }
      if (!res.headersSent) {
        if (bounded instanceof PageChangeHttpError) return respondPageChangeError(res, bounded);
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "page-change mcp failed" },
          id: rpcId,
        });
      }
      transport?.close().catch(() => {});
      server?.close().catch(() => {});
    } finally {
      release();
    }
  });
  app.all(PAGE_CHANGE_MCP_PATH, methodNotAllowed);
  return { path: PAGE_CHANGE_MCP_PATH, tool: PAGE_CHANGE_MCP_TOOL };
}
