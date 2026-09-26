import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MATRIX, PAYMENT_REQUEST_HEADER_NAMES, SCHEMA_FIXTURE, SDS, WAVE } from "./constants.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../..");

function unusedPort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
    server.once("error", reject);
  });
}

export function parseSseOrJson(text) {
  const dataLines = String(text).split(/\r?\n/).filter((line) => line.startsWith("data: "));
  const raw = dataLines.length ? dataLines.at(-1).slice(6) : text;
  return JSON.parse(raw);
}

function decodeHeader(encoded) {
  if (typeof encoded !== "string" || !encoded) return null;
  for (const encoding of ["base64url", "base64"]) {
    try {
      const decoded = JSON.parse(Buffer.from(encoded, encoding).toString("utf8"));
      if (decoded && typeof decoded === "object") return decoded;
    } catch {
      // try the next encoding
    }
  }
  return null;
}

export function decodePaymentRequired(response, bodyText) {
  const encoded = response.headers.get("payment-required");
  const fromHeader = decodeHeader(encoded);
  if (fromHeader) return fromHeader;
  if (bodyText) {
    try {
      const body = JSON.parse(bodyText);
      if (body?.x402Version || body?.accepts) return body;
    } catch {
      // body is not a payment-required object
    }
  }
  return null;
}

function assertNoPaymentHeaders(headers) {
  for (const name of PAYMENT_REQUEST_HEADER_NAMES) {
    if (headers[name] || headers[name.toUpperCase()]) {
      throw new Error(`refused payment request header ${name}`);
    }
  }
}

export async function getUnpaid(base, path, query, method = "GET") {
  const headers = { accept: "application/json" };
  assertNoPaymentHeaders(headers);
  const response = await fetch(`${base}${path}${query || ""}`, {
    method,
    redirect: "error",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const bodyText = await response.text();
  const challenge = decodePaymentRequired(response, bodyText);
  const accepted = Array.isArray(challenge?.accepts)
    ? challenge.accepts.find((row) => row.network === SDS.network && row.scheme === SDS.scheme)
      || challenge.accepts[0]
    : null;
  return {
    status: response.status,
    method,
    requestHeaders: {},
    accepts: challenge?.accepts || [],
    payTo: accepted?.payTo || null,
    amount: accepted?.amount ?? null,
    offerReceiptAmount: challenge?.extensions?.["offer-receipt"]?.info?.offers?.[0]?.payload?.amount ?? null,
    extensions: challenge?.extensions || null,
    x402Version: challenge?.x402Version ?? null,
  };
}

async function mcpRpc(base, { method, params, id, sessionId }) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  assertNoPaymentHeaders(headers);
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    redirect: "error",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(id == null ? {} : { id }),
      method,
      params,
    }),
  });
  const text = await response.text();
  return { response, text, payload: text ? parseSseOrJson(text) : null };
}

export async function listMcpTools(base) {
  const initialize = await mcpRpc(base, {
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "w830-amount-matrix", version: "0.0.1" },
    },
  });
  const sessionId = initialize.response.headers.get("mcp-session-id");
  if (sessionId) {
    await mcpRpc(base, {
      method: "notifications/initialized",
      params: {},
      sessionId,
    });
  }

  const tools = [];
  let cursor = null;
  let pages = 0;
  let listStatus = null;
  do {
    pages += 1;
    if (pages > 20) throw new Error("tools/list pagination exceeds the page ceiling");
    const listed = await mcpRpc(base, {
      id: pages + 1,
      method: "tools/list",
      params: cursor ? { cursor } : {},
      sessionId,
    });
    listStatus = listed.response.status;
    const pageTools = listed.payload?.result?.tools;
    if (!Array.isArray(pageTools)) throw new Error("tools/list is missing tools");
    tools.push(...pageTools);
    const next = listed.payload?.result?.nextCursor;
    cursor = typeof next === "string" && next ? next : null;
  } while (cursor);

  return {
    initializeStatus: initialize.response.status,
    listStatus,
    pages,
    tools,
  };
}

export async function captureUnpaidMatrix(base) {
  const http = {};
  for (const route of MATRIX) {
    http[route.path] = await getUnpaid(base, route.path, route.query, route.method);
  }
  const [openapiResponse, wellKnownResponse, mcp] = await Promise.all([
    fetch(`${base}/openapi.json`, { redirect: "error", signal: AbortSignal.timeout(15_000) }),
    fetch(`${base}/.well-known/x402`, { redirect: "error", signal: AbortSignal.timeout(15_000) }),
    listMcpTools(base),
  ]);
  const openapi = await openapiResponse.json();
  const wellKnownX402 = await wellKnownResponse.json();
  return {
    schemaVersion: SCHEMA_FIXTURE,
    wave: WAVE,
    id: "cold-run",
    unpublished: true,
    paymentAttempted: false,
    origin: base,
    observed: { http, mcp, openapi, wellKnownX402 },
  };
}

export async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
    child.once("exit", resolveStop);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolveStop();
    }, 2_000).unref();
  });
}

export async function startLocalMerchant() {
  const dataDir = await mkdtemp(join(tmpdir(), "w830-amount-matrix-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: SDS.origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      if (!output.includes("MCP server:  POST /mcp (")) return;
      clearTimeout(timer);
      resolveReady();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return {
    base: `http://127.0.0.1:${port}`,
    child,
    output: () => output,
    async close() {
      await stopChild(child);
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
