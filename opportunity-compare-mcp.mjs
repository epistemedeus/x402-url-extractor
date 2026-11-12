import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { asMerchantZodObject, merchantWireDescriptor, setLegacyMcpToolList } from "./mcp-zod4-wire.mjs";
import {
  PageChangeHttpError,
  assertPageChangeJsonDepth,
  beginPageChangeExchange,
  drainRequest,
  pageChangeHttpLimits,
  pageChangeServiceOutcome,
  parseBoundedJson,
} from "./page-change-http.mjs";
import { MCP_SERVER_INPUT_LIMITS } from "./mcp-tool-input-ceiling.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";
import {
  PRODUCT,
  SCHEMA_VERSION,
  TOOL_COMPARE,
  callTool,
  toolDescriptors,
} from "./vendor/opportunity-eligibility/eligibility-tool/tools.mjs";
import { registerOpportunityTools, zodFromJsonSchema } from "./vendor/opportunity-eligibility/eligibility-tool/register.mjs";

// Free, no-fetch sibling of /mcp/page-change. Registers only opportunity_compare.
// Mounted only when OPPORTUNITY_COMPARE_MCP is the exact value "on".
// opportunity_eligibility is not mounted. No payment, no outbound network.

export const OPPORTUNITY_COMPARE_MCP_PATH = "/mcp/opportunity-compare";
export const OPPORTUNITY_COMPARE_MCP_TOOL = TOOL_COMPARE;
export const OPPORTUNITY_COMPARE_MCP_ENV = "OPPORTUNITY_COMPARE_MCP";
export const OPPORTUNITY_COMPARE_MCP_FLAG_ON = "on";
export const OPPORTUNITY_COMPARE_MCP_SERVER_NAME = "samedaydesk-opportunity-compare";
export const OPPORTUNITY_COMPARE_MCP_INSTRUCTIONS = "Combine opportunity decision records the caller already holds. The only tool is opportunity_compare. Do not fetch URLs, extract remote pages, or take payment.";

export const OPPORTUNITY_COMPARE_MCP_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

export function isOpportunityCompareMcpPath(pathname) {
  const path = String(pathname || "").split("?", 1)[0].toLowerCase().replace(/\/+$/, "");
  return path === OPPORTUNITY_COMPARE_MCP_PATH;
}

export function isOpportunityCompareMcpEnabled(env = process.env) {
  return String(env?.[OPPORTUNITY_COMPARE_MCP_ENV] ?? "") === OPPORTUNITY_COMPARE_MCP_FLAG_ON;
}

function isJsonContentType(req) {
  const type = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  return type === "application/json" || /^application\/[a-z0-9.+-]*\+json$/.test(type);
}

function admissionBody(error) {
  const known = error instanceof PageChangeHttpError;
  const code = known ? error.code : "opportunity_compare_failed";
  return {
    ok: false,
    product: PRODUCT,
    schemaVersion: SCHEMA_VERSION,
    charged: false,
    error: code,
    message: known ? String(error.message).slice(0, 160) : "opportunity compare failed",
    code,
  };
}

function respondAdmissionError(res, error) {
  const status = error instanceof PageChangeHttpError ? error.status : 500;
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  return res.status(status).json(admissionBody(error));
}

function unknownToolError(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (body.jsonrpc !== "2.0" || body.method !== "tools/call") return null;
  if (!Object.hasOwn(body, "id")) return null;
  const name = body.params?.name;
  if (typeof name !== "string" || name.length === 0 || name === OPPORTUNITY_COMPARE_MCP_TOOL) return null;
  return {
    jsonrpc: "2.0",
    id: body.id,
    error: {
      code: -32602,
      message: "Unknown tool",
      data: { nextMethod: "tools/list", availableTools: [OPPORTUNITY_COMPARE_MCP_TOOL] },
    },
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
      message: `Method not allowed: this MCP server is stateless; POST JSON-RPC to ${OPPORTUNITY_COMPARE_MCP_PATH}.`,
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
 * Mount POST /mcp/opportunity-compare on an existing Express app.
 * A fresh SDK server and transport handles each POST. GET returns 405 so a
 * probe does not look like a missing listener.
 *
 * The POST reuses the free page-change byte ceiling, active-upload slot,
 * deadline, and disconnect abort. It does not take payment and does not fetch.
 *
 * @param {import("express").Express} app
 * @param {{ env?: NodeJS.ProcessEnv, observe?: Function | null }} [options]
 */
export function mountOpportunityCompareMcp(app, { env = process.env, observe = null } = {}) {
  const compareDescriptor = toolDescriptors().find((d) => d.name === OPPORTUNITY_COMPARE_MCP_TOOL);
  merchantWireDescriptor(asMerchantZodObject(zodFromJsonSchema(z, compareDescriptor.inputSchema)));
  const limits = pageChangeHttpLimits(env);

  app.post(OPPORTUNITY_COMPARE_MCP_PATH, async (req, res) => {
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
          note = (outcome, code) => { try { record(outcome, code); } catch { /* Optional measurement. */ } };
        }
        return note;
      };
      if (!isJsonContentType(req)) {
        drainRequest(req, res);
        ensureNote()("refused", "unsupported_media_type");
        return res.status(415).json(admissionBody(new PageChangeHttpError("unsupported media type", { status: 415, code: "unsupported_media_type" })));
      }
      const exchange = beginPageChangeExchange(req, res, limits);
      if (!exchange.ok) {
        if (exchange.error.code === "page_change_busy") res.set("Retry-After", "1");
        ensureNote()(pageChangeServiceOutcome(null, exchange.error), exchange.error?.code);
        return respondAdmissionError(res, exchange.error);
      }
      release = () => exchange.release();
      ensureNote();
      let parsed;
      try {
        parsed = parseBoundedJson(await exchange.read());
      } catch (error) {
        const bounded = boundedToolError(error);
        drainRequest(req, res);
        note(
          exchange.abort.signal.aborted ? "aborted" : pageChangeServiceOutcome(null, bounded),
          exchange.abort.signal.aborted ? "request_aborted" : bounded?.code,
        );
        return respondAdmissionError(res, bounded);
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.hasOwn(parsed, "id")) rpcId = parsed.id;
      if (Array.isArray(parsed)) {
        note("refused", "invalid_request");
        return res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Invalid Request" },
          id: null,
        });
      }
      const unknown = unknownToolError(parsed);
      if (unknown) {
        note("refused", "unknown_tool");
        return res.status(200).json(unknown);
      }
      const journalCompare = parsed?.method === "tools/call";
      if (!journalCompare) note("omit");
      const suppliedArguments = parsed?.params?.arguments && typeof parsed.params.arguments === "object" && !Array.isArray(parsed.params.arguments)
        ? parsed.params.arguments
        : undefined;
      if (journalCompare && suppliedArguments?.records !== undefined) {
        try {
          assertPageChangeJsonDepth(suppliedArguments.records, limits, "records");
        } catch (error) {
          const bounded = boundedToolError(error);
          note(pageChangeServiceOutcome(null, bounded), bounded?.code);
          return respondAdmissionError(res, bounded);
        }
      }
      server = new McpServer({
        name: OPPORTUNITY_COMPARE_MCP_SERVER_NAME,
        version: SERVICE_VERSION,
      }, {
        instructions: OPPORTUNITY_COMPARE_MCP_INSTRUCTIONS,
        ...MCP_SERVER_INPUT_LIMITS,
      });
      const host = {
        registerTool(name, config, handler) {
          return server.registerTool(name, config, async (args) => {
            const result = await handler(suppliedArguments ?? args);
            const output = result?.structuredContent || (result?.content?.[0]?.type === "text"
              ? safeJson(result.content[0].text)
              : null);
            if (output && output.ok === true) {
              if (Buffer.byteLength(JSON.stringify(output), "utf8") > limits.maxOutputBytes) {
                throw new PageChangeHttpError("response exceeds server ceiling", { status: 413, code: "output_too_large" });
              }
            }
            const failed = Boolean(result?.isError) || !output || output.ok !== true || output.charged !== false;
            if (journalCompare) {
              if (exchange.abort.signal.aborted) note("aborted", "request_aborted");
              else if (failed) note("refused", typeof output?.code === "string" ? output.code : typeof output?.error === "string" ? output.error : undefined);
              else note(pageChangeServiceOutcome(output));
            }
            return result;
          });
        },
      };
      const registered = registerOpportunityTools(host, { z, only: [OPPORTUNITY_COMPARE_MCP_TOOL] });
      setLegacyMcpToolList(server, registered);
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (error) {
      const bounded = boundedToolError(error);
      try {
        note(pageChangeServiceOutcome(null, bounded), bounded?.code);
      } catch { /* Optional measurement. */ }
      if (!res.headersSent) {
        if (bounded instanceof PageChangeHttpError) return respondAdmissionError(res, bounded);
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "opportunity-compare mcp failed" },
          id: rpcId,
        });
      }
      transport?.close().catch(() => {});
      server?.close().catch(() => {});
    } finally {
      release();
    }
  });
  app.all(OPPORTUNITY_COMPARE_MCP_PATH, methodNotAllowed);
  return { path: OPPORTUNITY_COMPARE_MCP_PATH, tool: OPPORTUNITY_COMPARE_MCP_TOOL, mounted: true };
}

export function maybeMountOpportunityCompareMcp(app, options = {}) {
  const env = options.env ?? process.env;
  if (!isOpportunityCompareMcpEnabled(env)) {
    return { mounted: false, path: OPPORTUNITY_COMPARE_MCP_PATH, tool: OPPORTUNITY_COMPARE_MCP_TOOL };
  }
  return mountOpportunityCompareMcp(app, { ...options, env });
}

// Direct installed-path entry used by tests and by Adoption and Learning on the
// same caller-held records as the hosted handler. Fetches nothing.
export async function compareOpportunityRecords(args, ctx = {}) {
  return callTool(OPPORTUNITY_COMPARE_MCP_TOOL, args, ctx);
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
