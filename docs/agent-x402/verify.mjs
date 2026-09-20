#!/usr/bin/env node
/**
 * Cold-follow verifier for docs/agent-x402.
 * Unpaid MCP initialize + tools/list, plus seeded-failure rejection.
 * Not a wallet, publisher, registry client, or payment wrapper.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "fixtures");
export const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const MCP_PROTOCOL = "2025-11-25";
const FORBIDDEN_PROTOCOL = "2026-07-28";
const TIMEOUT_MS = 15_000;
export const MAX_BYTES = 1_000_000;
const USER_AGENT = "samedaydesk-agent-x402-docs/0.1.0";
const MAX_PAGES = 20;

const KILL_COMMANDS = new Set([
  "publish",
  "registry",
  "pay",
  "payment",
  "checkout",
  "tools/call",
  "call",
]);

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

class Rejected extends Error {
  constructor(message) {
    super(message);
    this.name = "Rejected";
  }
}

function reject(message) {
  throw new Rejected(message);
}

export function parseSseOrJson(text, label) {
  const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} did not return JSON or JSON SSE data`);
  }
}

export async function readCappedText(response, label, maxBytes = MAX_BYTES) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    if (response.body) {
      try { await response.body.cancel(); } catch { /* already closed */ }
    }
    throw new Error(`${label} response exceeded ${maxBytes} bytes`);
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = typeof response.text === "function" ? await response.text() : "";
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`${label} response exceeded ${maxBytes} bytes`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new Error(`${label} response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function headerMap(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

function hasPaymentHeaders(headers) {
  const map = headerMap(headers);
  for (const name of PAYMENT_HEADER_NAMES) {
    if (map[name]) return true;
  }
  return false;
}

function hasPaymentMeta(params) {
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

export function rejectSeededDocument(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    reject("seeded document must be a JSON object");
  }
  const kind = doc.kind;
  const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : doc;

  if (kind === "registry_publish" || looksLikeRegistryPublish(payload)) {
    reject("registry publish is a kill condition");
  }
  if (kind === "checkout_mutation" || looksLikeCheckoutMutation(payload)) {
    reject("checkout or payment mutation is a kill condition");
  }

  const headers = payload.headers || doc.headers;
  if (hasPaymentHeaders(headers)) {
    reject("payment headers are forbidden on unpaid discovery");
  }
  if (headerMap(headers)["mcp-method"]) {
    reject("Mcp-Method header is forbidden on initialize-era discovery");
  }

  const rpcMethod = payload.method;
  const params = payload.params;
  if (rpcMethod === "tools/call") {
    reject("tools/call is paid; unpaid discovery stops at tools/list");
  }
  if (hasPaymentMeta(params) && rpcMethod !== "tools/list") {
    reject("payment headers are forbidden on unpaid discovery");
  }

  const protocol = payload.result?.protocolVersion
    || payload.params?.protocolVersion
    || payload.protocolVersion;
  if (protocol === FORBIDDEN_PROTOCOL) {
    reject("protocolVersion 2026-07-28 is out of scope for unpaid discovery");
  }

  if (kind === "initialize") {
    reject("initialize fixture is not a completed unpaid tools/list inventory");
  }

  const tools = payload.tools || payload.result?.tools;
  if (Array.isArray(tools)) {
    assertDiscoveryInventory(tools);
    reject("seeded document was accepted as unpaid discovery");
  }

  reject("seeded document is not unpaid MCP discovery");
}

export async function postRpc(method, params, id, extraHeaders = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(LIVE_MCP_URL, {
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
  if (response.status !== 200) {
    if (response.body) {
      try { await response.body.cancel(); } catch { /* already closed */ }
    }
    throw new Error(`${method} HTTP ${response.status}`);
  }
  const text = await readCappedText(response, method);
  const payload = parseSseOrJson(text, method);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${method} did not return a JSON-RPC object`);
  }
  if (payload.error) {
    throw new Error(`${method} JSON-RPC error ${payload.error.code}: ${payload.error.message}`);
  }
  if (payload.id !== id) {
    throw new Error(`${method} JSON-RPC id mismatch`);
  }
  return { response, text, payload };
}

export async function discoverLive(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const initialize = await postRpc("initialize", {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: "samedaydesk-agent-x402-docs", version: "0.1.0" },
  }, 1, {}, { fetchImpl });
  const result = initialize.payload.result || {};
  if (result.protocolVersion === FORBIDDEN_PROTOCOL) {
    reject("protocolVersion 2026-07-28 is out of scope for unpaid discovery");
  }
  if (result.protocolVersion !== MCP_PROTOCOL) {
    throw new Error(`initialize protocolVersion ${result.protocolVersion}`);
  }
  if (result.serverInfo?.name !== "x402-data-gateway") {
    throw new Error(`unexpected serverInfo.name ${result.serverInfo?.name}`);
  }

  const sessionId = initialize.response.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const tools = [];
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  let listId = 2;
  do {
    pages += 1;
    if (pages > MAX_PAGES) throw new Error("tools/list pagination exceeds the page ceiling");
    const listed = await postRpc("tools/list", cursor ? { cursor } : {}, listId, extra, { fetchImpl });
    listId += 1;
    const pageTools = listed.payload.result?.tools;
    if (!Array.isArray(pageTools)) throw new Error("tools/list is missing tools");
    tools.push(...pageTools);
    cursor = listed.payload.result?.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("tools/list repeated nextCursor");
      seenCursors.add(cursor);
    }
  } while (cursor);

  const found = assertDiscoveryInventory(tools);
  return {
    lane: "agent-x402-mcp-unpaid-discovery",
    ok: true,
    protocolVersion: result.protocolVersion,
    server: {
      name: result.serverInfo.name,
      version: result.serverInfo.version || null,
    },
    toolCount: found.names.length,
    extractPresent: true,
    extractBatchPresent: true,
    extraToolCount: found.names.length - 2,
    names: found.names,
    sessionHeaderSent: Boolean(sessionId),
    sourceHeaderSent: false,
    paymentAttempted: false,
    registryPublishAttempted: false,
    toolsCallAttempted: false,
    checkoutMutated: false,
    exactGlobalCountRequired: false,
  };
}

function loadFixture(path) {
  const text = readFileSync(path, "utf8");
  if (text.includes("\uFEFF")) throw new Error(`${path} must not have a BOM`);
  return JSON.parse(text);
}

function fixturePaths(explicit) {
  if (explicit) {
    return [isAbsolute(explicit) ? explicit : join(process.cwd(), explicit)];
  }
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(FIXTURE_DIR, name));
}

export function rejectSeededFixtures(explicit) {
  const results = [];
  for (const path of fixturePaths(explicit)) {
    const doc = loadFixture(path);
    const expectReject = doc.expectReject;
    if (typeof expectReject !== "string" || expectReject.length === 0) {
      throw new Error(`${path} is missing expectReject`);
    }
    let reason;
    try {
      rejectSeededDocument(doc);
      throw new Error(`${path} was not rejected`);
    } catch (error) {
      if (!(error instanceof Rejected)) throw error;
      reason = error.message;
    }
    if (reason !== expectReject) {
      throw new Error(`${path} rejected with ${JSON.stringify(reason)}, expected ${JSON.stringify(expectReject)}`);
    }
    results.push({
      id: doc.id || path,
      rejected: true,
      reason,
    });
  }
  return results;
}

function printKillAndExit(command) {
  const publishKill = command === "publish" || command === "registry";
  const line = publishKill
    ? "KILL: publish/registry is out of scope for MCP unpaid discovery"
    : "KILL: payment/checkout is out of scope for MCP unpaid discovery";
  const report = {
    ok: false,
    killed: true,
    command,
    reason: line,
    paymentAttempted: false,
    registryPublishAttempted: false,
    checkoutMutated: false,
  };
  console.log(JSON.stringify(report, null, 2));
  console.error(line);
  process.exit(2);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let command = "all";
  let fixture;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--fixture") {
      fixture = args[i + 1];
      i += 1;
      continue;
    }
    if (KILL_COMMANDS.has(token)) return { command: "kill", kill: token, fixture };
    if (token === "discover" || token === "reject-seeded" || token === "all") {
      command = token;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return { command, fixture };
}

async function main() {
  const { command, kill, fixture } = parseArgs(process.argv);
  if (command === "kill") printKillAndExit(kill);

  const report = {
    pack: "docs/agent-x402",
    liveMcp: LIVE_MCP_URL,
    protocolVersion: MCP_PROTOCOL,
  };

  if (command === "discover" || command === "all") {
    report.discover = await discoverLive();
  }
  if (command === "reject-seeded" || command === "all") {
    report.seeded = rejectSeededFixtures(fixture);
  }

  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
}

const isDirect = Boolean(process.argv[1])
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Rejected ? `REJECTED: ${error.message}` : error.stack || error.message);
    process.exit(1);
  });
}
