import { asMerchantZodObject, merchantWireDescriptor, setLegacyMcpToolList } from "./mcp-zod4-wire.mjs";
// Stateless Streamable HTTP profile for the existing free page comparison.
// One tool, compare_page_observations. It calls the same admission and
// compare core as POST /recipes/page-change. It does not proxy through the
// paid /mcp catalog, fetch URLs, or take payment.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { pageChangeMcpDescription, pageChangeMcpInputSchema } from "./page-change-input-contract.mjs";
import { pageChangeMcpOutputSchema } from "./page-change-mcp-output-schema.mjs";
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
import { MCP_SERVER_INPUT_LIMITS } from "./mcp-tool-input-ceiling.mjs";
import {
  PageChangeContinuationError,
  bindPageChangeContinuation,
  containsCredentialLikeInput,
  issuePageChangeContinuation,
  pageChangeContinuationEventId,
  pageChangeContinuationKeyring,
  pageChangeContinuationRefusalBody,
  pageChangeDiscovery,
  readPageChangeContinuationRequest,
  verifyPageChangeContinuationToken,
} from "./page-change-continuation.mjs";
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
    error: {
      code: -32602, message: "Unknown tool",
      data: { nextMethod: "tools/list", availableTools: [PAGE_CHANGE_MCP_TOOL] },
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
      message: `Method not allowed: this MCP server is stateless; POST JSON-RPC to ${PAGE_CHANGE_MCP_PATH}.`,
    },
    id: null,
  });
}

// Continuation refusals reuse an existing allowlisted journal label, so no
// caller text and no token ever reaches the outcome row.
const CONTINUATION_JOURNAL_CODE = "invalid_page_change_input";

function continuationRefusal(error) {
  const code = error instanceof PageChangeContinuationError ? error.code : "continuation_invalid";
  return pageChangeContinuationRefusalBody(code, { product: PAGE_CHANGE_HTTP_PRODUCT, schemaVersion: PAGE_CHANGE_HTTP_SCHEMA });
}

// Runs only when the caller sent _meta samedaydesk/continuation. Verifies and
// binds before any compare, so a refusal spends no worker time.
function admitContinuation(request, suppliedArguments, env) {
  if (request.invalid) throw new PageChangeContinuationError("continuation_invalid");
  if (!pageChangeContinuationKeyring(env)) throw new PageChangeContinuationError("continuation_unavailable");
  if (containsCredentialLikeInput(suppliedArguments)) throw new PageChangeContinuationError("continuation_credential_input");
  if (request.token === null) {
    const after = suppliedArguments?.after;
    if (!after || typeof after !== "object" || Array.isArray(after) || after.missing === true) {
      throw new PageChangeContinuationError("continuation_second_observation_incomplete");
    }
    return { previous: null };
  }
  const payload = verifyPageChangeContinuationToken(request.token, { env, correlationId: request.correlationId });
  bindPageChangeContinuation(payload, suppliedArguments);
  return { previous: payload };
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
export function pageChangeMcpToolConfig() {
  return {
    title: "Compare page observations",
    description: pageChangeMcpDescription(),
    inputSchema: pageChangeMcpInputSchema(),
    outputSchema: pageChangeMcpOutputSchema,
    annotations: PAGE_CHANGE_MCP_ANNOTATIONS,
    _meta: { samedaydesk: { charged: false, paymentRequired: false } },
  };
}

export function mountPageChangeMcp(app, { env = process.env, observe = null, discoveryEvidence = null } = {}) {
  const toolConfig = pageChangeMcpToolConfig();
  merchantWireDescriptor(asMerchantZodObject(toolConfig.inputSchema));
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
          note = (outcome, code, meta) => { try { record(outcome, code, meta); } catch { /* Optional measurement. */ } };
        }
        return note;
      };
      if (!isJsonContentType(req)) {
        drainRequest(req, res);
        ensureNote()("refused", "unsupported_media_type");
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
        ensureNote()(pageChangeServiceOutcome(null, exchange.error), exchange.error?.code);
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
        note(
          exchange.abort.signal.aborted ? "aborted" : pageChangeServiceOutcome(null, bounded),
          exchange.abort.signal.aborted ? "request_aborted" : bounded?.code,
        );
        return respondPageChangeError(res, bounded);
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
      // Zod is discovery-only. Its copy reorders keys and changes the artifact
      // hash. Keep the parsed object itself. Cloning it walks the whole graph
      // and can throw RangeError before admission, outside this handler's catch.
      const suppliedArguments = parsed?.params?.arguments && typeof parsed.params.arguments === "object" && !Array.isArray(parsed.params.arguments)
        ? parsed.params.arguments
        : undefined;
      // Absent for every caller that does not opt in, so their path is unchanged.
      const continuationRequest = journalCompare ? readPageChangeContinuationRequest(parsed?.params?._meta) : null;
      if (journalCompare && suppliedArguments) {
        try {
          if (suppliedArguments.before !== undefined) assertPageChangeJsonDepth(suppliedArguments.before, limits, "before");
          if (suppliedArguments.after !== undefined) assertPageChangeJsonDepth(suppliedArguments.after, limits, "after");
        } catch (error) {
          const bounded = boundedToolError(error);
          note(pageChangeServiceOutcome(null, bounded), bounded?.code);
          return respondPageChangeError(res, bounded);
        }
      }
      server = new McpServer({
        name: PAGE_CHANGE_MCP_SERVER_NAME,
        version: SERVICE_VERSION,
      }, {
        instructions: PAGE_CHANGE_MCP_INSTRUCTIONS,
        ...MCP_SERVER_INPUT_LIMITS,
      });
      const registered = server.registerTool(PAGE_CHANGE_MCP_TOOL, toolConfig, async () => {
        let continued = null;
        if (continuationRequest) {
          try {
            continued = admitContinuation(continuationRequest, suppliedArguments, env);
          } catch (error) {
            note("refused", CONTINUATION_JOURNAL_CODE);
            return toolText(continuationRefusal(error), true);
          }
        }
        try {
          let output = await executePageChangeComparison(suppliedArguments, env, {
            abortSignal: exchange.abort.signal,
            timeoutMs: exchange.remainingMs(),
          });
          let eventMeta;
          if (continued && output?.ok === true && output.charged === false && continuationRequest.save) {
            let observed = null;
            try { observed = typeof discoveryEvidence === "function" ? discoveryEvidence(req) : null; } catch { observed = null; }
            const discovery = pageChangeDiscovery({ observed, declared: continuationRequest.declared });
            try {
              const continuation = issuePageChangeContinuation({
                after: suppliedArguments.after,
                fields: suppliedArguments.fields,
                previous: continued.previous,
                env,
                discovery,
              });
              output = { ...output, continuation };
            } catch (error) {
              if (!(error instanceof PageChangeContinuationError)) throw error;
              note("refused", CONTINUATION_JOURNAL_CODE);
              return toolText(continuationRefusal(error), true);
            }
          }
          // A retried step of one chain maps to one journal id, never the token.
          if (continued?.previous) {
            eventMeta = { eventId: pageChangeContinuationEventId(continued.previous.correlationId, continued.previous.step) };
          }
          if (output?.ok === true) {
            if (Buffer.byteLength(JSON.stringify(output), "utf8") > limits.maxOutputBytes) {
              throw new PageChangeHttpError("response exceeds server ceiling", { status: 413, code: "output_too_large" });
            }
          }
          const failed = !output || output.ok !== true || output.charged !== false;
          if (journalCompare) {
            if (exchange.abort.signal.aborted) note("aborted", "request_aborted");
            else if (failed) note("refused", typeof output?.error === "string" ? output.error : undefined);
            else note(pageChangeServiceOutcome(output), undefined, eventMeta);
          }
          return toolText(output, failed);
        } catch (error) {
          const bounded = boundedToolError(error);
          if (journalCompare) {
            note(
              exchange.abort.signal.aborted ? "aborted" : pageChangeServiceOutcome(null, bounded),
              exchange.abort.signal.aborted ? "request_aborted" : bounded?.code,
            );
          }
          return toolText(failureBody(bounded), true);
        }
      });
      setLegacyMcpToolList(server, [[PAGE_CHANGE_MCP_TOOL, registered]]);
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
        note(
          pageChangeServiceOutcome(null, bounded),
          bounded?.code,
        );
      } catch { /* Optional measurement. */ }
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
