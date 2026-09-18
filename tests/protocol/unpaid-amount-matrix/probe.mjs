import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MATRIX, PAYMENT_REQUEST_HEADER_NAMES, SDS } from "./constants.mjs";

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

export function decodePaymentRequired(response, bodyText) {
  const encoded = response.headers.get("payment-required");
  if (encoded) return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
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

export function isLoopbackOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
}

export function assertLoopbackOrigin(origin) {
  if (!isLoopbackOrigin(origin)) {
    throw new Error(`refused non-loopback origin ${origin}`);
  }
}

function assertNoPaymentHeaders(headers) {
  const map = {};
  for (const [key, value] of Object.entries(headers || {})) {
    map[String(key).toLowerCase()] = value;
  }
  for (const name of PAYMENT_REQUEST_HEADER_NAMES) {
    if (map[name]) {
      throw new Error(`refused payment request header ${name}`);
    }
  }
}

export async function getUnpaid(base, path, query) {
  const headers = { accept: "application/json" };
  assertNoPaymentHeaders(headers);
  const response = await fetch(`${base}${path}${query || ""}`, {
    method: "GET",
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
    method: "GET",
    requestHeaders: { ...headers },
    accepts: challenge?.accepts || [],
    payTo: accepted?.payTo || null,
    amount: accepted?.amount ?? null,
    offerReceiptAmount: challenge?.extensions?.["offer-receipt"]?.info?.offers?.[0]?.payload?.amount ?? null,
    extensions: challenge?.extensions || null,
    x402Version: challenge?.x402Version ?? null,
  };
}

export async function listMcpTools(base) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  assertNoPaymentHeaders(headers);
  const initialize = await fetch(`${base}/mcp`, {
    method: "POST",
    redirect: "error",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "r11-402-01-unpaid-amount-matrix", version: "0.0.1" },
      },
    }),
  });
  const initializeText = await initialize.text();
  const sessionId = initialize.headers.get("mcp-session-id");
  const extra = sessionId ? { "mcp-session-id": sessionId } : {};
  const listed = await fetch(`${base}/mcp`, {
    method: "POST",
    redirect: "error",
    headers: { ...headers, ...extra },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const listedText = await listed.text();
  const payload = parseSseOrJson(listedText);
  return {
    initializeStatus: initialize.status,
    listStatus: listed.status,
    tools: payload?.result?.tools || [],
  };
}

export async function captureUnpaidMatrix(base) {
  assertLoopbackOrigin(base);
  const http = {};
  for (const route of MATRIX) {
    http[route.path] = await getUnpaid(base, route.path, route.query);
  }
  const [openapiResponse, wellKnownResponse, mcp] = await Promise.all([
    fetch(`${base}/openapi.json`, { redirect: "error", signal: AbortSignal.timeout(15_000) }),
    fetch(`${base}/.well-known/x402`, { redirect: "error", signal: AbortSignal.timeout(15_000) }),
    listMcpTools(base),
  ]);
  const openapi = await openapiResponse.json();
  const wellKnownX402 = await wellKnownResponse.json();
  return {
    schemaVersion: "samedaydesk.unpaid-amount-matrix-fixture.v1",
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
  const dataDir = await mkdtemp(join(tmpdir(), "r11-402-01-unpaid-matrix-"));
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
