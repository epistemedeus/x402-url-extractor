import { request as httpsRequest } from "node:https";

import {
  createPinnedLookup,
  normalizePaymentTarget,
  publicAddress,
  resolvePublicAddress,
} from "./payment-offer-preflight.mjs";

const MAX_INITIALIZE_BYTES = 32_768;
const MAX_MCP_BYTES = 1_000_000;
const MAX_OPENAPI_BYTES = 1_000_000;
const MAX_TOOL_COUNT = 500;
const MAX_OPERATION_COUNT = 2_000;
const DEFAULT_MCP_BUDGET = 65_536;
const DEFAULT_OPENAPI_BUDGET = 524_288;
const DOH_URL = "https://cloudflare-dns.com/dns-query";

export class AgentSurfaceBudgetAuditError extends Error {
  constructor(message, { code = "invalid_request", statusCode = 400 } = {}) {
    super(message);
    this.name = "AgentSurfaceBudgetAuditError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function integer(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AgentSurfaceBudgetAuditError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function normalizeAgentSurfaceBudgetAuditInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentSurfaceBudgetAuditError("input must be an object");
  }
  const allowed = new Set(["origin", "mcpPath", "openApiPath", "mcpBudgetBytes", "openApiBudgetBytes"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) throw new AgentSurfaceBudgetAuditError(`unsupported input field: ${unknown[0]}`);

  let target;
  try {
    target = normalizePaymentTarget(String(input.origin || ""));
  } catch {
    throw new AgentSurfaceBudgetAuditError("origin must be a credential-free public HTTPS origin on port 443");
  }
  if (target.pathname !== "/" || target.search || target.port) {
    throw new AgentSurfaceBudgetAuditError("origin must not contain a path, query, fragment, or non-default port");
  }
  const safePath = (value, fallback, name) => {
    const path = String(value || fallback);
    if (!/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(path) || path.includes("{") || path.includes("?")) {
      throw new AgentSurfaceBudgetAuditError(`${name} must be one exact root-relative path`);
    }
    return path;
  };
  return Object.freeze({
    origin: target.origin,
    mcpPath: safePath(input.mcpPath, "/mcp", "mcpPath"),
    openApiPath: safePath(input.openApiPath, "/openapi.json", "openApiPath"),
    mcpBudgetBytes: integer(input.mcpBudgetBytes, DEFAULT_MCP_BUDGET, 8_192, MAX_MCP_BYTES, "mcpBudgetBytes"),
    openApiBudgetBytes: integer(input.openApiBudgetBytes, DEFAULT_OPENAPI_BUDGET, 32_768, MAX_OPENAPI_BYTES, "openApiBudgetBytes"),
  });
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? null), "utf8");
}

function tokenEstimate(bytes) {
  return Math.ceil(bytes / 4);
}

export async function resolveAuditAddress(hostname, {
  dohFetchImpl = fetch,
  lookupImpl,
} = {}) {
  try {
    return await resolvePublicAddress(hostname, { lookupImpl });
  } catch (error) {
    if (error?.code !== "ssrf_rejected") throw error;
  }
  const answers = [];
  for (const type of ["A", "AAAA"]) {
    const url = new URL(DOH_URL);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);
    const response = await dohFetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/dns-json", "user-agent": "SameDayDesk-Agent-Surface-Budget-Audit/1.0" },
    });
    if (!response?.ok) throw new AgentSurfaceBudgetAuditError("public DNS resolver was unavailable", { code: "dns_failed", statusCode: 502 });
    const text = await response.text();
    if (byteLength(text) > 65_536) throw new AgentSurfaceBudgetAuditError("public DNS response exceeded the byte ceiling", { code: "dns_failed", statusCode: 502 });
    let payload;
    try { payload = JSON.parse(text); } catch { throw new AgentSurfaceBudgetAuditError("public DNS response was invalid", { code: "dns_failed", statusCode: 502 }); }
    if (payload?.Status !== 0 || !Array.isArray(payload?.Answer) || payload.Answer.length > 32) continue;
    for (const answer of payload.Answer) {
      if ((answer?.type === 1 || answer?.type === 28) && typeof answer?.data === "string") answers.push(answer.data);
    }
  }
  const unique = [...new Set(answers)];
  if (!unique.length) throw new AgentSurfaceBudgetAuditError("target hostname has no public DNS address", { code: "dns_failed", statusCode: 502 });
  if (unique.some((address) => !publicAddress(address))) {
    throw new AgentSurfaceBudgetAuditError("target hostname resolves to a non-public address", { code: "ssrf_rejected" });
  }
  const address = unique[0];
  return { address, family: address.includes(":") ? 6 : 4 };
}

function parseRpc(text, label) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = lines.length ? lines.at(-1).slice(6) : text;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON or JSON SSE data`);
  }
  if (payload?.error) throw new Error(`${label} returned JSON-RPC error ${payload.error.code}: ${payload.error.message}`);
  return payload;
}

async function requestBounded(url, {
  body = null,
  headers = {},
  maximum,
  method = "GET",
  parse = "json",
  resolved,
  timeoutMs = 8_000,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = httpsRequest(url, {
      method,
      headers: {
        accept: "application/json, text/event-stream",
        "user-agent": "SameDayDesk-Agent-Surface-Budget-Audit/1.0 (+https://samedaydesk.com)",
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        ...headers,
      },
      lookup: createPinnedLookup(resolved),
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if (parse === "none" && status >= 200 && status < 300) {
        settled = true;
        response.destroy();
        resolve({ headers: response.headers, status, text: "" });
        return;
      }
      if (status !== 200) {
        settled = true;
        response.destroy();
        reject(new Error(`${url.pathname} returned HTTP ${status}`));
        return;
      }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maximum) {
        settled = true;
        response.destroy();
        reject(new Error(`${url.pathname} response exceeded ${maximum} bytes`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maximum) {
          settled = true;
          response.destroy();
          reject(new Error(`${url.pathname} response exceeded ${maximum} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ headers: response.headers, status, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${url.pathname} request timed out`)));
    req.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    if (body) req.write(body);
    req.end();
  });
}

async function acquireMcp(request, { dohFetchImpl, lookupImpl } = {}) {
  const endpoint = new URL(request.mcpPath, request.origin);
  const resolved = await resolveAuditAddress(endpoint.hostname, { dohFetchImpl, lookupImpl });
  const rpc = async (method, params, id, maximum, sessionId = null) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const response = await requestBounded(endpoint, {
      body,
      maximum,
      method: "POST",
      resolved,
      headers: sessionId ? { "mcp-session-id": sessionId } : {},
    });
    return { payload: parseRpc(response.text, method), headers: response.headers, bytes: byteLength(response.text) };
  };
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "samedaydesk-surface-budget-audit", version: "1.0.0" },
  }, 1, MAX_INITIALIZE_BYTES);
  const rawSession = initialized.headers?.["mcp-session-id"];
  const sessionId = typeof rawSession === "string" && /^[\x21-\x7e]{1,256}$/.test(rawSession) ? rawSession : null;
  if (sessionId) {
    await requestBounded(endpoint, {
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      maximum: 1_024,
      method: "POST",
      parse: "none",
      resolved,
      headers: { "mcp-session-id": sessionId },
    });
  }
  const tools = [];
  const names = new Set();
  let cursor = null;
  let bytes = 0;
  let pages = 0;
  do {
    pages += 1;
    if (pages > 20) throw new Error("tools/list pagination exceeds the page ceiling");
    const listed = await rpc("tools/list", cursor ? { cursor } : {}, pages + 1, MAX_MCP_BYTES, sessionId);
    const pageTools = listed.payload?.result?.tools;
    if (!Array.isArray(pageTools)) throw new Error("tools/list is missing tools");
    bytes += listed.bytes;
    if (bytes > MAX_MCP_BYTES) throw new Error(`tools/list response exceeded ${MAX_MCP_BYTES} bytes`);
    for (const tool of pageTools) {
      const name = typeof tool?.name === "string" ? tool.name : "";
      if (!name || names.has(name)) throw new Error("tools/list contains missing or duplicate names");
      names.add(name);
      tools.push(tool);
      if (tools.length > MAX_TOOL_COUNT) throw new Error("tools/list exceeds the tool ceiling");
    }
    const next = listed.payload?.result?.nextCursor;
    if (next !== undefined && next !== null && (typeof next !== "string" || !/^[\x21-\x7e]{1,512}$/.test(next))) {
      throw new Error("tools/list returned an invalid cursor");
    }
    cursor = next || null;
  } while (cursor);
  return { bytes, pages, protocolVersion: initialized.payload?.result?.protocolVersion || null, server: initialized.payload?.result?.serverInfo || null, tools };
}

async function acquireOpenApi(request, { dohFetchImpl, lookupImpl } = {}) {
  const endpoint = new URL(request.openApiPath, request.origin);
  const resolved = await resolveAuditAddress(endpoint.hostname, { dohFetchImpl, lookupImpl });
  const response = await requestBounded(endpoint, { maximum: MAX_OPENAPI_BYTES, resolved });
  let document;
  try {
    document = JSON.parse(response.text);
  } catch {
    throw new Error("OpenAPI surface did not return JSON");
  }
  if (!document || typeof document !== "object" || Array.isArray(document) || !document.paths || typeof document.paths !== "object") {
    throw new Error("OpenAPI surface is missing paths");
  }
  return { bytes: byteLength(response.text), document };
}

function analyzeMcp(surface, budget) {
  const tools = surface.tools.map((tool) => {
    const selection = {
      name: tool?.name ?? null,
      title: tool?.title ?? null,
      description: tool?.description ?? null,
      inputSchema: tool?.inputSchema ?? null,
      outputSchema: tool?.outputSchema ?? null,
      annotations: tool?.annotations ?? null,
      _meta: tool?._meta ?? null,
    };
    return {
      name: typeof tool?.name === "string" ? tool.name.slice(0, 128) : "unnamed",
      bytes: byteLength(selection),
      descriptionBytes: byteLength(tool?.description || ""),
      inputSchemaBytes: byteLength(tool?.inputSchema || null),
      outputSchemaBytes: byteLength(tool?.outputSchema || null),
      hasTitle: typeof tool?.title === "string" && tool.title.trim().length > 0,
      hasDescription: typeof tool?.description === "string" && tool.description.trim().length > 0,
      hasInputSchema: Boolean(tool?.inputSchema && typeof tool.inputSchema === "object"),
      hasOutputSchema: Boolean(tool?.outputSchema && typeof tool.outputSchema === "object"),
    };
  }).sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name));
  const selectionBytes = tools.reduce((sum, tool) => sum + tool.bytes, 0);
  return {
    available: true,
    bytes: surface.bytes,
    byteDerivedTokenEstimate: tokenEstimate(surface.bytes),
    budgetBytes: budget,
    withinBudget: surface.bytes <= budget,
    protocolVersion: surface.protocolVersion,
    server: {
      name: typeof surface.server?.name === "string" ? surface.server.name.slice(0, 128) : null,
      version: typeof surface.server?.version === "string" ? surface.server.version.slice(0, 64) : null,
    },
    toolCount: tools.length,
    pageCount: surface.pages || 1,
    selectionBytes,
    missingTitleCount: tools.filter((tool) => !tool.hasTitle).length,
    missingDescriptionCount: tools.filter((tool) => !tool.hasDescription).length,
    missingInputSchemaCount: tools.filter((tool) => !tool.hasInputSchema).length,
    missingOutputSchemaCount: tools.filter((tool) => !tool.hasOutputSchema).length,
    heaviestTools: tools.slice(0, 8),
  };
}

function analyzeOpenApi(surface, budget) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(surface.document.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object") continue;
      operations.push({
        method: method.toUpperCase(),
        path: String(path).slice(0, 512),
        bytes: byteLength(operation),
        summaryBytes: byteLength(operation.summary || operation.description || ""),
        hasOperationId: typeof operation.operationId === "string" && operation.operationId.length > 0,
      });
      if (operations.length > MAX_OPERATION_COUNT) throw new Error("OpenAPI operation count exceeds the ceiling");
    }
  }
  operations.sort((left, right) => right.bytes - left.bytes || `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
  return {
    available: true,
    bytes: surface.bytes,
    byteDerivedTokenEstimate: tokenEstimate(surface.bytes),
    budgetBytes: budget,
    withinBudget: surface.bytes <= budget,
    operationCount: operations.length,
    missingOperationIdCount: operations.filter((operation) => !operation.hasOperationId).length,
    heaviestOperations: operations.slice(0, 8),
  };
}

function failure(error) {
  const message = String(error?.message || error);
  const code = /exceeded .*bytes|exceeds the .*ceiling/.test(message)
    ? "surface_too_large"
    : /HTTP 404|missing paths|missing or exceeds/.test(message)
      ? "surface_unavailable"
      : /did not return JSON|JSON-RPC/.test(message)
        ? "surface_invalid"
        : "bounded_transport_failure";
  return { available: false, failureCode: code };
}

export function agentSurfaceBudgetAuditOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      product: { type: "string", const: "samedaydesk-agent-surface-budget-audit" },
      version: { type: "string", const: "1.0.0" },
      checkedAt: { type: "string", format: "date-time" },
      decision: { type: "string", enum: ["within_budget", "optimize", "surface_incomplete"] },
      request: { type: "object" },
      mcp: { type: "object" },
      openapi: { type: "object" },
      actions: { type: "array", items: { type: "string" } },
      boundary: { type: "object" },
    },
    required: ["ok", "product", "version", "checkedAt", "decision", "request", "mcp", "openapi", "actions", "boundary"],
  };
}

export async function agentSurfaceBudgetAudit(input, {
  mcpAcquireImpl = acquireMcp,
  openApiAcquireImpl = acquireOpenApi,
  now = () => new Date(),
} = {}) {
  const request = normalizeAgentSurfaceBudgetAuditInput(input);
  const [mcpResult, openApiResult] = await Promise.allSettled([
    mcpAcquireImpl(request),
    openApiAcquireImpl(request),
  ]);
  const mcp = mcpResult.status === "fulfilled" ? analyzeMcp(mcpResult.value, request.mcpBudgetBytes) : failure(mcpResult.reason);
  const openapi = openApiResult.status === "fulfilled" ? analyzeOpenApi(openApiResult.value, request.openApiBudgetBytes) : failure(openApiResult.reason);
  const actions = [];
  if (!mcp.available) actions.push("Publish a bounded credential-free MCP initialize and tools/list surface on the declared path.");
  else {
    if (!mcp.withinBudget) actions.push("Add progressive MCP tool discovery or split the server into task-focused tool sets so clients do not ingest the full catalog every turn.");
    if (mcp.heaviestTools.some((tool) => tool.bytes > 8_192)) actions.push("Reduce the heaviest tool definitions by moving examples and long guidance to linked resources while preserving selection-critical descriptions and schemas.");
    if (mcp.missingTitleCount || mcp.missingDescriptionCount || mcp.missingInputSchemaCount) actions.push("Give every tool a concise selection title, disambiguating description, and explicit input schema.");
    if (mcp.missingOutputSchemaCount) actions.push("Add truthful outputSchema declarations where the runtime can guarantee them; keep optional or dynamic fields explicit.");
  }
  if (!openapi.available) actions.push("Publish a bounded same-origin OpenAPI document for exact operation discovery.");
  else {
    if (!openapi.withinBudget) actions.push("Publish route-scoped or tag-scoped OpenAPI discovery views so agents can fetch only the operations relevant to their task.");
    if (openapi.heaviestOperations.some((operation) => operation.bytes > 32_768)) actions.push("Move long operation examples or prose to linked documentation while retaining request and response contracts in OpenAPI.");
    if (openapi.missingOperationIdCount) actions.push("Add stable operationId values so agents and generated clients can address operations without path heuristics.");
  }
  const complete = mcp.available && openapi.available;
  const withinBudget = complete && mcp.withinBudget && openapi.withinBudget;
  return {
    ok: complete,
    product: "samedaydesk-agent-surface-budget-audit",
    version: "1.0.0",
    checkedAt: now().toISOString(),
    decision: !complete ? "surface_incomplete" : withinBudget ? "within_budget" : "optimize",
    request,
    mcp,
    openapi,
    actions: [...new Set(actions)],
    boundary: {
      credentialsUsed: false,
      toolsCalled: false,
      targetPaymentSigned: false,
      targetPaymentSent: false,
      redirectsFollowed: false,
      responseBodiesReturned: false,
      schemasRetained: false,
      sessionIdentifiersReturned: false,
      tokenEstimateMethod: "ceil(UTF-8 bytes / 4); comparative estimate, not tokenizer billing",
    },
  };
}

export const AGENT_SURFACE_BUDGET_AUDIT_EXAMPLE = Object.freeze({
  ok: true,
  product: "samedaydesk-agent-surface-budget-audit",
  version: "1.0.0",
  checkedAt: "2026-08-12T15:00:00.000Z",
  decision: "optimize",
  request: { origin: "https://agents.samedaydesk.com", mcpPath: "/mcp", openApiPath: "/openapi.json", mcpBudgetBytes: 65536, openApiBudgetBytes: 524288 },
  mcp: { available: true, bytes: 90000, byteDerivedTokenEstimate: 22500, budgetBytes: 65536, withinBudget: false, protocolVersion: "2025-11-25", server: { name: "example", version: "1.0.0" }, toolCount: 20, pageCount: 1, selectionBytes: 87000, missingTitleCount: 0, missingDescriptionCount: 0, missingInputSchemaCount: 0, missingOutputSchemaCount: 20, heaviestTools: [] },
  openapi: { available: true, bytes: 300000, byteDerivedTokenEstimate: 75000, budgetBytes: 524288, withinBudget: true, operationCount: 25, missingOperationIdCount: 0, heaviestOperations: [] },
  actions: ["Add progressive MCP tool discovery or split the server into task-focused tool sets so clients do not ingest the full catalog every turn."],
  boundary: { credentialsUsed: false, toolsCalled: false, targetPaymentSigned: false, targetPaymentSent: false, redirectsFollowed: false, responseBodiesReturned: false, schemasRetained: false, sessionIdentifiersReturned: false, tokenEstimateMethod: "ceil(UTF-8 bytes / 4); comparative estimate, not tokenizer billing" },
});
