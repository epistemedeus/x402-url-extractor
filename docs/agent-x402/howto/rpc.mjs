#!/usr/bin/env node
/**
 * Unpaid MCP JSON-RPC helper for docs/agent-x402/howto.
 * Posts initialize / tools/list / unpaid tools/call. Refuses payment,
 * batch-settlement, publish, and checkout locally.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_PROTOCOL = "2025-11-25";
const FORBIDDEN_PROTOCOL = "2026-07-28";
const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1_000_000;
const USER_AGENT = "samedaydesk-agent-x402-howto/0.1.0";
const MAX_PAGES = 20;
const FORBIDDEN_SCHEME = "batch-settlement";

const EXTRACT_OUTPUT_REQUIRED = Object.freeze([
  "ok", "requestedUrl", "finalUrl", "url", "status", "sourceOk", "error",
  "contentType", "title", "description", "canonical", "lang", "openGraph",
  "twitter", "jsonLd", "headings", "links", "text", "aiReadiness", "capture",
  "fetchedAt",
]);

const EXTRACT_BATCH_OUTPUT_REQUIRED = Object.freeze([
  "ok", "product", "schemaVersion", "quote", "jobId", "jobStatus",
  "stopReason", "partial", "sources", "accounting", "costInputs", "charged",
  "boundary",
]);

const PAYMENT_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
  "x-api-token",
  "api-key",
  "x-payment",
  "payment-signature",
  "x-payment-signature",
]);

const KILL_COMMANDS = new Set([
  "publish",
  "registry",
  "pay",
  "payment",
  "checkout",
  "enable-batch-settlement",
]);

export class Rejected extends Error {
  constructor(message) {
    super(message);
    this.name = "Rejected";
  }
}

export function reject(message) {
  throw new Rejected(message);
}

export function parseSseOrJson(text, label) {
  const dataLines = String(text || "").split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON or JSON SSE data`);
  }
}

function headerMap(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

export function hasPaymentHeaders(headers) {
  const map = headerMap(headers);
  for (const name of PAYMENT_HEADER_NAMES) {
    if (map[name]) return true;
  }
  return false;
}

export function hasPaymentMeta(params) {
  const meta = params && typeof params === "object" ? params._meta : null;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return Boolean(meta["x402/payment"] || meta.x402);
}

function assertObjectSchema(schema, label) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    reject(`${label} is missing`);
  }
  if (schema.type !== "object") reject(`${label} type is not object`);
  if (schema.additionalProperties !== false) {
    reject(`${label} additionalProperties must be false`);
  }
}

function assertRequiredPaths(schema, required, label) {
  const listed = Array.isArray(schema?.required) ? schema.required : [];
  for (const path of required) {
    if (!listed.includes(path)) reject(`${label} omitted required ${path}`);
  }
}

function assertExtractTool(tool) {
  assertObjectSchema(tool.inputSchema, "extract inputSchema");
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  if (!required.includes("url")) reject("extract inputSchema omitted required url");
  const url = tool.inputSchema.properties?.url;
  if (!url || url.type !== "string") reject("extract inputSchema.url type is not string");
  assertRequiredPaths(tool.outputSchema, EXTRACT_OUTPUT_REQUIRED, "extract outputSchema");
}

function assertExtractBatchTool(tool) {
  assertObjectSchema(tool.inputSchema, "extract_batch inputSchema");
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  if (!required.includes("urls")) reject("extract_batch inputSchema omitted required urls");
  const urls = tool.inputSchema.properties?.urls;
  if (!urls || urls.type !== "array") reject("extract_batch inputSchema.urls type is not array");
  if (urls.minItems !== 1) reject("extract_batch inputSchema.urls minItems is not 1");
  if (urls.maxItems !== 5) reject("extract_batch inputSchema.urls maxItems is not 5");
  assertRequiredPaths(tool.outputSchema, EXTRACT_BATCH_OUTPUT_REQUIRED, "extract_batch outputSchema");
}

export function assertDiscoveryInventory(tools) {
  if (!Array.isArray(tools)) reject("tools/list must return an array");
  const found = {};
  for (const name of ["extract", "extract_batch"]) {
    const matches = tools.filter((tool) => tool?.name === name);
    if (matches.length !== 1) reject(`tools/list missing or duplicate ${name}`);
    found[name] = matches[0];
  }
  assertExtractTool(found.extract);
  assertExtractBatchTool(found.extract_batch);
  return {
    extract: found.extract,
    batch: found.extract_batch,
    names: tools.map((tool) => tool?.name),
  };
}

export function assertExactOnlyAccepts(accepts, label = "accepts") {
  if (!Array.isArray(accepts) || accepts.length === 0) {
    reject(`${label} must list at least one payment option`);
  }
  for (const offer of accepts) {
    const scheme = String(offer?.scheme || "");
    if (scheme === FORBIDDEN_SCHEME) {
      reject("batch-settlement scheme is forbidden for unpaid MCP discovery");
    }
    if (scheme !== "exact") {
      reject(`${label} scheme ${scheme || "(missing)"} is not exact`);
    }
  }
}

function looksLikeRegistryPublish(payload) {
  if (!payload || typeof payload !== "object") return false;
  const url = String(payload.url || payload.endpoint || "");
  const method = String(payload.method || "").toUpperCase();
  if (/registry\.modelcontextprotocol\.io/i.test(url) && /\/v0\.1\/publish/i.test(url)) {
    return true;
  }
  if (method === "POST" && /\/v0\.1\/publish/i.test(url)) return true;
  if (payload.kind === "registry_publish") return true;
  if (payload.action === "publish" && /registry/i.test(String(payload.target || payload.url || ""))) {
    return true;
  }
  return false;
}

function looksLikeCheckoutMutation(payload) {
  if (!payload || typeof payload !== "object") return false;
  const url = String(payload.url || payload.endpoint || "");
  const action = String(payload.action || payload.kind || "");
  if (payload.kind === "checkout_mutation") return true;
  if (/checkout/i.test(url) || /checkout/i.test(action)) return true;
  if (payload.sku && (payload.price !== undefined || payload.newPrice !== undefined)) return true;
  return false;
}

function collectAccepts(doc) {
  const payload = doc?.payload && typeof doc.payload === "object" ? doc.payload : doc;
  const nested = payload?.accepts
    || payload?.result?.structuredContent?.accepts
    || payload?.result?.x402?.accepts
    || payload?._meta?.x402?.accepts;
  return Array.isArray(nested) ? nested : [];
}

export function rejectSeededDocument(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    reject("seeded document must be a JSON object");
  }
  const kind = doc.kind;
  const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : doc;

  if (kind === "registry_publish" || looksLikeRegistryPublish(payload) || looksLikeRegistryPublish(doc)) {
    reject("registry publish is a kill condition");
  }
  if (kind === "checkout_mutation" || looksLikeCheckoutMutation(payload) || looksLikeCheckoutMutation(doc)) {
    reject("checkout or payment mutation is a kill condition");
  }

  const headers = payload.headers || doc.headers;
  if (hasPaymentHeaders(headers)) {
    reject("payment headers are forbidden on unpaid discovery");
  }
  if (headerMap(headers)["mcp-method"]) {
    reject("Mcp-Method header is forbidden on initialize-era discovery");
  }

  const accepts = collectAccepts(doc);
  if (kind === "offer" || accepts.some((offer) => String(offer?.scheme || "") === FORBIDDEN_SCHEME)) {
    assertExactOnlyAccepts(accepts.length ? accepts : [{ scheme: FORBIDDEN_SCHEME }]);
  }

  const rpcMethod = payload.method;
  const params = payload.params;
  if (rpcMethod === "tools/call" && hasPaymentMeta(params)) {
    reject("tools/call with payment is paid; unpaid discovery does not settle");
  }
  if (hasPaymentMeta(params) && rpcMethod !== "tools/list" && rpcMethod !== "tools/call") {
    reject("payment headers are forbidden on unpaid discovery");
  }

  const protocol = payload.result?.protocolVersion
    || payload.params?.protocolVersion
    || payload.protocolVersion;
  if (protocol === FORBIDDEN_PROTOCOL) {
    reject("protocolVersion 2026-07-28 is out of scope for unpaid discovery");
  }

  if (kind === "initialize") {
    if (payload.result?.protocolVersion === FORBIDDEN_PROTOCOL) {
      reject("protocolVersion 2026-07-28 is out of scope for unpaid discovery");
    }
    reject("initialize fixture is not a completed unpaid tools/list inventory");
  }

  const tools = payload.tools
    || payload.result?.tools
    || (kind === "inventory" ? payload.tools : null);
  if (Array.isArray(tools)) {
    assertDiscoveryInventory(tools);
    reject("seeded document was accepted as unpaid discovery");
  }

  reject("seeded document is not unpaid MCP discovery");
}

function originFromEnv() {
  const raw = process.env.MCP_ORIGIN || "";
  if (!raw) reject("MCP_ORIGIN is required for unpaid RPC");
  let url;
  try {
    url = new URL(raw);
  } catch {
    reject("MCP_ORIGIN is not a URL");
  }
  if (url.username || url.password) reject("MCP_ORIGIN must be credential-free");
  if (!["http:", "https:"].includes(url.protocol)) reject("MCP_ORIGIN must be http(s)");
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    reject("non-loopback MCP_ORIGIN must be https");
  }
  return url.href.replace(/\/$/, "");
}

function stateDir() {
  return process.env.MCP_STATE_DIR || "";
}

function readSessionHeaders() {
  const headers = {};
  if (process.env.MCP_SESSION_ID) headers["mcp-session-id"] = process.env.MCP_SESSION_ID;
  const dir = stateDir();
  if (!dir) return headers;
  try {
    const saved = JSON.parse(readFileSync(join(dir, "session.json"), "utf8"));
    if (typeof saved.sessionId === "string" && saved.sessionId) {
      headers["mcp-session-id"] = saved.sessionId;
    }
  } catch {
    /* no session yet */
  }
  return headers;
}

function writeSession(sessionId) {
  const dir = stateDir();
  if (!dir || !sessionId) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), `${JSON.stringify({ sessionId }, null, 2)}\n`);
}

export async function postRpc(origin, method, params, id, extraHeaders = {}) {
  if (hasPaymentHeaders(extraHeaders)) {
    reject("payment headers are forbidden on unpaid discovery");
  }
  if (headerMap(extraHeaders)["mcp-method"]) {
    reject("Mcp-Method header is forbidden on initialize-era discovery");
  }
  if (hasPaymentMeta(params)) {
    reject("payment headers are forbidden on unpaid discovery");
  }
  const response = await fetch(origin, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    throw new Error(`${method} response exceeded ${MAX_BYTES} bytes`);
  }
  return { response, text, payload: parseSseOrJson(text, method) };
}

function challengeFromCall(payload) {
  const result = payload?.result;
  const error = payload?.error;
  let body = result?.structuredContent;
  if (!body && typeof result?.content?.[0]?.text === "string") {
    try { body = JSON.parse(result.content[0].text); } catch { body = null; }
  }
  const fromError = error?.data?.x402 || error?.data;
  const pr = (body && (body.x402Version || body.accepts)) ? body
    : (fromError && (fromError.x402Version || fromError.accepts)) ? fromError
      : body;
  return { result, error, pr };
}

function handlerRan(pr, result) {
  if (!pr) return true;
  if (result?.structuredContent?.requestedUrl) return true;
  if (result?.structuredContent?.ok === true && result?.structuredContent?.url) return true;
  const text = result?.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.ok === true && parsed?.requestedUrl) return true;
      if (parsed?.ok === true && !parsed?.error && parsed?.url) return true;
    } catch {
      /* not extract JSON */
    }
  }
  return false;
}

export async function rpcInitialize(origin) {
  const listed = await postRpc(origin, "initialize", {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "samedaydesk-agent-x402-howto", version: "0.1.0" },
  }, 1);
  if (!listed.response.ok) throw new Error(`initialize HTTP ${listed.response.status}`);
  const result = listed.payload.result || {};
  if (result.protocolVersion === FORBIDDEN_PROTOCOL) {
    reject("protocolVersion 2026-07-28 is out of scope for unpaid discovery");
  }
  if (result.protocolVersion !== MCP_PROTOCOL) {
    throw new Error(`initialize protocolVersion ${result.protocolVersion}`);
  }
  if (result.serverInfo?.name !== "x402-data-gateway") {
    throw new Error(`unexpected serverInfo.name ${result.serverInfo?.name}`);
  }
  const sessionId = listed.response.headers.get("mcp-session-id");
  writeSession(sessionId);
  return {
    ok: true,
    method: "initialize",
    protocolVersion: result.protocolVersion,
    serverName: result.serverInfo.name,
    serverVersion: result.serverInfo.version || null,
    sessionId: sessionId || null,
    paymentAttempted: false,
  };
}

export async function rpcToolsList(origin) {
  const extra = readSessionHeaders();
  const tools = [];
  let cursor;
  let pages = 0;
  let listId = 2;
  do {
    pages += 1;
    if (pages > MAX_PAGES) throw new Error("tools/list pagination exceeds the page ceiling");
    const listed = await postRpc(origin, "tools/list", cursor ? { cursor } : {}, listId, extra);
    listId += 1;
    if (!listed.response.ok) throw new Error(`tools/list HTTP ${listed.response.status}`);
    const pageTools = listed.payload.result?.tools;
    if (!Array.isArray(pageTools)) throw new Error("tools/list is missing tools");
    tools.push(...pageTools);
    cursor = listed.payload.result?.nextCursor;
  } while (cursor);
  const found = assertDiscoveryInventory(tools);
  for (const tool of [found.extract, found.batch]) {
    const accepts = tool?._meta?.x402?.accepts;
    if (Array.isArray(accepts) && accepts.length) assertExactOnlyAccepts(accepts, `${tool.name} _meta.x402.accepts`);
  }
  return {
    ok: true,
    method: "tools/list",
    extractPresent: true,
    extractBatchPresent: true,
    toolCount: found.names.length,
    extraToolCount: found.names.length - 2,
    names: found.names,
    paymentAttempted: false,
    toolsCallAttempted: false,
    batchSettlement: false,
  };
}

export async function rpcUnpaid402(origin, toolName = "extract") {
  if (toolName !== "extract" && toolName !== "extract_batch") {
    reject(`unpaid-402 tool ${toolName} is not extract or extract_batch`);
  }
  const extra = readSessionHeaders();
  const args = toolName === "extract"
    ? { url: "https://example.com/" }
    : { urls: ["https://example.com/"], fields: ["title"] };
  const listed = await postRpc(origin, "tools/call", { name: toolName, arguments: args }, 3, extra);
  const { result, error, pr } = challengeFromCall(listed.payload);
  const required = Boolean(
    pr && (pr.x402Version || pr.accepts)
    && (result?.isError === true
      || error?.code === -32042
      || error?.code === 402
      || /payment required/i.test(String(pr.error || error?.message || ""))),
  );
  if (!required) {
    reject("unpaid tools/call did not return a payment-required challenge");
  }
  if (handlerRan(pr, result)) {
    reject("unpaid tools/call ran the handler");
  }
  const accepts = Array.isArray(pr.accepts) ? pr.accepts : [];
  assertExactOnlyAccepts(accepts, "unpaid 402 accepts");
  return {
    ok: true,
    method: "tools/call",
    tool: toolName,
    unpaid: true,
    paymentRequired: true,
    handlerRan: false,
    scheme: "exact",
    batchSettlement: false,
    x402Version: pr.x402Version ?? null,
    paymentAttempted: false,
  };
}

function parseRpcArgs(argv) {
  const out = { command: null, tool: "extract", pay: false, headers: {} };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--tool") {
      out.tool = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--pay") {
      out.pay = true;
      continue;
    }
    if (token === "--header") {
      const raw = args[i + 1] || "";
      i += 1;
      const eq = raw.indexOf("=");
      if (eq <= 0) throw new Error("expected --header Name=value");
      out.headers[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    if (token.startsWith("-")) throw new Error(`unknown flag: ${token}`);
    if (!out.command) out.command = token;
    else throw new Error(`unexpected argument: ${token}`);
  }
  return out;
}

export async function runRpcCommand(argv = process.argv) {
  const args = parseRpcArgs(argv);
  const command = args.command;
  if (!command) throw new Error("rpc command required");

  if (KILL_COMMANDS.has(command) || command === "call") {
    if (command === "enable-batch-settlement") {
      reject("batch-settlement scheme is forbidden for unpaid MCP discovery");
    }
    if (command === "publish" || command === "registry") {
      reject("registry publish is a kill condition");
    }
    reject("checkout or payment mutation is a kill condition");
  }

  if (hasPaymentHeaders(args.headers)) {
    reject("payment headers are forbidden on unpaid discovery");
  }
  if (headerMap(args.headers)["mcp-method"]) {
    reject("Mcp-Method header is forbidden on initialize-era discovery");
  }
  if (args.pay || command === "tools-call") {
    reject("tools/call with payment is paid; unpaid discovery does not settle");
  }

  const origin = originFromEnv();
  if (command === "initialize") return rpcInitialize(origin);
  if (command === "tools-list") return rpcToolsList(origin);
  if (command === "unpaid-402") return rpcUnpaid402(origin, args.tool);
  throw new Error(`unknown rpc command: ${command}`);
}

const isDirect = Boolean(process.argv[1])
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  runRpcCommand(process.argv).then((report) => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exit(0);
  }).catch((error) => {
    const rejected = error instanceof Rejected;
    const report = {
      ok: false,
      rejected,
      reason: error.message,
      paymentAttempted: false,
      registryPublishAttempted: false,
      checkoutMutated: false,
      batchSettlementEnabled: false,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (rejected) process.stderr.write(`${error.message}\n`);
    else process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

export {
  EXTRACT_BATCH_OUTPUT_REQUIRED,
  EXTRACT_OUTPUT_REQUIRED,
  FORBIDDEN_PROTOCOL,
  FORBIDDEN_SCHEME,
  HERE,
  LIVE_MCP_URL,
  MCP_PROTOCOL,
  PAYMENT_HEADER_NAMES,
};
