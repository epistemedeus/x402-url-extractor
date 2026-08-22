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

import { AsyncLocalStorage } from "node:async_hooks";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper } from "@x402/mcp";
import {
  buildRegisteredCatalog,
  createMcpTypedTelemetryAttempt,
  digestIssuedOffer,
  productSkuForTool,
  resourceForTool,
} from "./mcp-typed-telemetry-producer.mjs";

const mcpTypedAttemptAls = new AsyncLocalStorage();

const MCP_PAYMENT_META_KEY = "x402/payment";
const MAX_PAYMENT_SIGNATURE_HEADER_BYTES = 32 * 1024;
const UNREGISTERED_SENTINEL_BINDING = Object.freeze({
  tool: "x",
  productSku: "y",
  resource: "z",
  issuedOfferDigest: "0".repeat(64),
});

export function createX402ToolMeta(accepts) {
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error("MCP x402 tool metadata requires at least one payment option");
  }
  return {
    x402: {
      paymentRequired: true,
      accepts,
    },
  };
}

/**
 * Bridge x402 clients that send the signed PaymentPayload in the standard
 * PAYMENT-SIGNATURE HTTP header but fail to mirror it into MCP tools/call
 * metadata. The existing @x402/mcp wrapper remains the only verifier and
 * settlement authority. A valid-looking header only becomes untrusted input
 * to that wrapper; it never bypasses payment verification.
 */
export function injectPaymentSignatureHeader(req) {
  const body = req?.body;
  if (!body || Array.isArray(body) || body.method !== "tools/call") return false;
  if (!body.params || typeof body.params !== "object" || Array.isArray(body.params)) return false;

  const existingMeta = body.params._meta;
  if (existingMeta && typeof existingMeta === "object" && existingMeta[MCP_PAYMENT_META_KEY]) {
    return false;
  }

  const raw = req.get?.("PAYMENT-SIGNATURE");
  if (typeof raw !== "string" || raw.length === 0) return false;
  if (Buffer.byteLength(raw, "utf8") > MAX_PAYMENT_SIGNATURE_HEADER_BYTES) return false;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return false;

  let payment;
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 0 || decoded.length > MAX_PAYMENT_SIGNATURE_HEADER_BYTES) return false;
    payment = JSON.parse(decoded.toString("utf8"));
  } catch {
    return false;
  }
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) return false;
  if (!Number.isInteger(payment.x402Version) || !payment.payload || typeof payment.payload !== "object") {
    return false;
  }

  body.params._meta = {
    ...(existingMeta && typeof existingMeta === "object" && !Array.isArray(existingMeta) ? existingMeta : {}),
    [MCP_PAYMENT_META_KEY]: payment,
  };
  return true;
}

// Turn a tool's raw result object into an MCP tool result. Errors are returned as a
// clean structured ok:false payload (not thrown) so the caller always gets legible JSON.
export function asToolResult(obj, { structured = false } = {}) {
  const result = { content: [{ type: "text", text: JSON.stringify(obj) }] };
  if (structured && obj && typeof obj === "object" && !Array.isArray(obj)) {
    result.structuredContent = obj;
  }
  return result;
}

function isJsonRpcObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonRpcHasId(body) {
  return isJsonRpcObject(body) && Object.hasOwn(body, "id");
}

function jsonRpcToolName(body) {
  const name = body?.params?.name;
  return typeof name === "string" ? name : null;
}

function isJsonRpcResponseMessage(message) {
  return (
    isJsonRpcObject(message)
    && message.jsonrpc === "2.0"
    && Object.hasOwn(message, "id")
    && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
    && !Object.hasOwn(message, "method")
  );
}

function isTypedPaymentRequiredResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  if (result.isError !== true) return false;
  const body = result.structuredContent;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return Number.isInteger(body.x402Version) && Array.isArray(body.accepts);
}

function classifyOutboundKind(message) {
  if (Object.hasOwn(message, "error")) return "transport_error";
  if (isTypedPaymentRequiredResult(message.result)) return "payment_required";
  return "tool_result";
}

function baselinePaidHandler(tool) {
  return async (args) => {
    if (tool.returnMcpResult) return tool.run(args);
    try {
      return asToolResult(await tool.run(args), { structured: Boolean(tool.outputSchema) });
    } catch (e) {
      return { ...asToolResult({ ok: false, error: String(e?.message || e) }), isError: true };
    }
  };
}

function observedPaidHandler(tool) {
  return async (args) => {
    const attempt = mcpTypedAttemptAls.getStore();
    attempt?.handlerStarted();
    if (tool.returnMcpResult) {
      try {
        const result = await tool.run(args);
        attempt?.handlerFinished({ isError: result?.isError === true });
        return result;
      } catch (error) {
        attempt?.handlerThrew();
        throw error;
      }
    }
    try {
      const result = asToolResult(await tool.run(args), { structured: Boolean(tool.outputSchema) });
      attempt?.handlerFinished({ isError: false });
      return result;
    } catch (e) {
      attempt?.handlerThrew();
      return { ...asToolResult({ ok: false, error: String(e?.message || e) }), isError: true };
    }
  };
}

function registerOfficialLifecycleHooks(resourceServer) {
  resourceServer.onAfterVerify((context) => {
    const result = context?.result;
    mcpTypedAttemptAls.getStore()?.observeVerifyOutcome({
      isValid: result?.isValid === true,
      skipHandler: Boolean(result?.skipHandler),
    });
    return undefined;
  });
  resourceServer.onVerifyFailure(() => {
    mcpTypedAttemptAls.getStore()?.observeVerifyOutcome({ isValid: false });
    return undefined;
  });
  resourceServer.onAfterSettle((context) => {
    const result = context?.result;
    mcpTypedAttemptAls.getStore()?.observeSettleOutcome({
      success: result?.success === true ? true : result?.success === false ? false : undefined,
    });
    return undefined;
  });
  resourceServer.onSettleFailure(() => {
    mcpTypedAttemptAls.getStore()?.observeSettleOutcome({ success: false });
    return undefined;
  });
  resourceServer.onVerifiedPaymentCanceled(() => {
    mcpTypedAttemptAls.getStore()?.observeVerifiedCancellation();
    return undefined;
  });
}

function createTypedTelemetryLifecycle(onAppend, { jsonResponse = false } = {}) {
  let sealed = false;
  let failures = 0;
  const pending = new Set();

  function finishEntry(entry) {
    if (entry.finished) return;
    entry.finished = true;
    pending.delete(entry);
    entry.resolve();
  }

  function invokeUser(decision, requestAttribution, entry) {
    let assimilated;
    try {
      // Assimilate without probing result.then first: a throwing `then` accessor
      // or Proxy trap is consumed by the resolving functions as a rejection and
      // stays inside this failure-safe terminal path.
      assimilated = Promise.resolve(onAppend(decision, requestAttribution));
    } catch {
      failures += 1;
      finishEntry(entry);
      return;
    }
    assimilated.then(
      () => finishEntry(entry),
      () => {
        failures += 1;
        finishEntry(entry);
      },
    );
  }

  function schedule(decision, requestAttribution = null) {
    if (sealed || typeof onAppend !== "function") return;
    let resolve;
    const done = new Promise((next) => {
      resolve = next;
    });
    const entry = { done, resolve, finished: false, timer: null };
    pending.add(entry);
    const launch = () => {
      entry.timer = null;
      invokeUser(decision, requestAttribution, entry);
    };
    if (jsonResponse && decision?.result !== "paid_success") {
      queueMicrotask(launch);
      return;
    }
    entry.timer = setTimeout(launch, 8);
  }

  async function drain({ timeoutMs } = {}) {
    const inFlight = [...pending];
    if (inFlight.length === 0) {
      return { drained: true, pending: 0, failures };
    }
    const wait = Promise.all(inFlight.map((entry) => entry.done));
    const budget = Number(timeoutMs);
    if (!Number.isFinite(budget)) {
      await wait;
      return { drained: pending.size === 0, pending: pending.size, failures };
    }
    let timer;
    try {
      const timedOut = await Promise.race([
        wait.then(() => false),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(true), Math.max(0, budget));
        }),
      ]);
      const left = pending.size;
      return {
        drained: timedOut === false && left === 0,
        pending: left,
        failures,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    schedule,
    flush: (options) => drain(options),
    shutdown(options) {
      sealed = true;
      return drain(options);
    },
  };
}

function decorateTransportSend(transport, attempt) {
  const originalSend = transport.send;
  let used = false;
  transport.send = async function typedSend(message, options) {
    let delegateResult;
    try {
      delegateResult = await originalSend.call(this, message, options);
    } catch (error) {
      if (attempt && !used) {
        used = true;
        attempt.noteTransportError();
        attempt.finalize({ kind: "transport_error" });
      }
      throw error;
    }
    if (attempt && !used && isJsonRpcResponseMessage(message)) {
      used = true;
      const kind = classifyOutboundKind(message);
      if (kind === "tool_result" && message.result?.isError === true) {
        attempt.overrideFinalApplicationError();
      }
      attempt.finalize({
        responseId: Object.hasOwn(message, "id") ? message.id : null,
        kind,
      });
    }
    return delegateResult;
  };
}

function createTypedAttemptForBody(body, catalog, onAppend, requestAttribution = null) {
  if (!isJsonRpcObject(body) || body.jsonrpc !== "2.0" || body.method !== "tools/call") {
    return { attempt: null };
  }
  const toolName = jsonRpcToolName(body);
  const registered = toolName ? catalog.get(toolName) : null;
  const hasId = jsonRpcHasId(body);
  const binding = registered?.binding ?? UNREGISTERED_SENTINEL_BINDING;
  const attempt = createMcpTypedTelemetryAttempt({
    binding,
    request: {
      jsonrpc: "2.0",
      hasId,
      id: hasId ? body.id : null,
      method: "tools/call",
    },
    onAppend: (decision) => onAppend(decision, requestAttribution),
  });
  if (!hasId) {
    attempt.finalize({ responseId: null, kind: "no_response" });
    return { attempt: null };
  }
  return { attempt };
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
 * @param {Array<{name:string,title?:string,description:string,price:string,inputSchema:Record<string,z.ZodTypeAny>,run:(args:any)=>Promise<any>,tags?:string[]}>} cfg.tools
 * @returns {Promise<{toolCount:number}>}
 */
export async function mountMcp(app, {
  facilitatorClient,
  network,
  payTo,
  serverInfo,
  tools,
  typedTelemetry = null,
  streamableHttpOptions = undefined,
  configureResourceServer = null,
} = {}) {
  const typedEnabled = typedTelemetry?.enabled === true;
  const jsonResponse = streamableHttpOptions?.enableJsonResponse === true;
  const typedLifecycle = typedEnabled
    ? createTypedTelemetryLifecycle(typedTelemetry.onAppend, { jsonResponse })
    : null;
  const onAppend = typedLifecycle
    ? (decision, requestAttribution) => typedLifecycle.schedule(decision, requestAttribution)
    : undefined;
  const catalogByName = buildRegisteredCatalog(tools);

  // Dedicated resource server for MCP, sharing the facilitator with the HTTP routes.
  const resourceServer = new x402ResourceServer(facilitatorClient).register(network, new ExactEvmScheme());
  await resourceServer.initialize();
  if (typeof configureResourceServer === "function") {
    await configureResourceServer(resourceServer);
  }
  if (typedEnabled) registerOfficialLifecycleHooks(resourceServer);

  // Pre-build the paid wrapper for each tool ONCE (buildPaymentRequirements is async).
  const prepared = [];
  for (const t of tools) {
    const registered = catalogByName.get(t.name);
    const accepts = await resourceServer.buildPaymentRequirements({
      scheme: "exact",
      network,
      payTo,
      price: t.price,
    });
    const issuedOfferDigest = digestIssuedOffer(accepts, registered);
    if (!issuedOfferDigest) {
      throw new Error(`issued offer digest missing for registered tool ${t.name}`);
    }
    const binding = Object.freeze({
      tool: registered.tool,
      productSku: registered.productSku,
      resource: registered.resource,
      issuedOfferDigest,
    });
    catalogByName.set(t.name, { ...registered, binding, issuedOfferDigest });
    const paid = createPaymentWrapper(resourceServer, {
      accepts,
      resource: {
        url: resourceForTool(t.name),
        description: t.description,
        mimeType: "application/json",
        serviceName: serverInfo.name,
        tags: t.tags,
      },
    });
    // paid(handler) -> MCP tool callback (args, extra) that verifies payment (from
    // extra._meta), runs the handler, then settles. We catch handler errors and return
    // a structured ok:false so a paid call never yields an opaque failure.
    const inner = paid(typedEnabled ? observedPaidHandler(t) : baselinePaidHandler(t));
    const handler = typedEnabled
      ? async (args, extra) => {
        const attempt = mcpTypedAttemptAls.getStore();
        attempt?.markPaidWrapperEntered();
        if (attempt && extra && Object.hasOwn(extra, "requestId")) {
          attempt.bindRequestId(extra.requestId);
        }
        const result = await inner(args, extra);
        if (attempt && !isTypedPaymentRequiredResult(result) && result?.isError !== true) {
          attempt.maybeReplayConfirmed();
        }
        return result;
      }
      : inner;
    prepared.push({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      paymentMeta: createX402ToolMeta(accepts),
      handler,
      binding,
    });
  }

  // A fresh MCP server per request (stateless mode requires server+transport per call).
  const makeServer = () => {
    const server = new McpServer(serverInfo);
    for (const t of prepared) {
      server.registerTool(t.name, {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        _meta: t.paymentMeta,
      }, t.handler);
    }
    return server;
  };

  const transportOptions = {
    ...(streamableHttpOptions && typeof streamableHttpOptions === "object" ? streamableHttpOptions : {}),
    sessionIdGenerator: undefined,
  };

  // Stateless streamable-HTTP transport. express.json() scoped to this route only.
  app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
    injectPaymentSignatureHeader(req);
    let requestAttribution = null;
    if (typedEnabled && typeof typedTelemetry?.attributionForRequest === "function") {
      try {
        requestAttribution = typedTelemetry.attributionForRequest(req);
      } catch {
        requestAttribution = null;
      }
    }
    const created = typedEnabled
      ? createTypedAttemptForBody(req.body, catalogByName, onAppend, requestAttribution)
      : { attempt: null };
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport(transportOptions);
    if (created.attempt) decorateTransportSend(transport, created.attempt);
    res.on("close", () => {
      try { transport.close(); } catch { /* noop */ }
      try { server.close?.(); } catch { /* noop */ }
    });
    const run = async () => {
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (e) {
        created.attempt?.noteTransportError();
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: String(e?.message || e) }, id: null });
        }
      }
    };
    if (created.attempt) {
      await mcpTypedAttemptAls.run(created.attempt, run);
      return;
    }
    await run();
  });

  // Stateless server: no standalone GET (SSE) or DELETE (session teardown) support.
  const methodNotAllowed = (_req, res) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this MCP server is stateless; POST JSON-RPC to /mcp." }, id: null });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const mountResult = {
    toolCount: prepared.length,
    catalog: Object.freeze(Object.fromEntries(
      [...catalogByName.entries()].map(([name, entry]) => [name, entry.binding]),
    )),
  };
  if (typedLifecycle) {
    mountResult.typedTelemetryLifecycle = {
      flush: (options) => typedLifecycle.flush(options),
      shutdown: (options) => typedLifecycle.shutdown(options),
    };
  }
  return mountResult;
}

export { mcpTypedAttemptAls, productSkuForTool, resourceForTool };
