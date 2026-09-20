import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
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

export function decodePaymentRequired(response, bodyText) {
  const encoded = response.headers.get("payment-required");
  if (encoded) {
    for (const encoding of ["base64url", "base64"]) {
      try {
        const decoded = JSON.parse(Buffer.from(encoded, encoding).toString("utf8"));
        if (decoded && typeof decoded === "object") return decoded;
      } catch {
        // try the next encoding
      }
    }
  }
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
  const host = String(url.hostname || "").replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function assertLoopbackOrigin(origin) {
  if (!isLoopbackOrigin(origin)) {
    throw new Error(`refused non-loopback origin ${origin}`);
  }
}

function assertNoPaymentHeaders(headers) {
  for (const name of PAYMENT_REQUEST_HEADER_NAMES) {
    if (headers[name] || headers[name.toUpperCase()]) {
      throw new Error(`refused payment request header ${name}`);
    }
  }
}

export async function getUnpaid(base, path, query) {
  assertLoopbackOrigin(base);
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
      || null
    : null;
  return {
    status: response.status,
    method: "GET",
    requestHeaders: {},
    accepts: challenge?.accepts || [],
    payTo: accepted?.payTo || null,
    amount: accepted?.amount ?? null,
    offerReceiptAmount: challenge?.extensions?.["offer-receipt"]?.info?.offers?.[0]?.payload?.amount ?? null,
    extensions: challenge?.extensions || null,
    x402Version: challenge?.x402Version ?? null,
  };
}

export async function listMcpTools(base) {
  assertLoopbackOrigin(base);
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
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "w1010-amount-matrix", version: "0.0.1" },
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
    initializeBytes: Buffer.byteLength(initializeText),
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

export async function startFakeFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = String(req.url || "").split("?")[0];
    if (req.method === "GET" && (path === "/supported" || path === "/supported/")) {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: SDS.network, scheme: SDS.scheme, x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && path === "/verify") {
      calls.verify += 1;
      return send(400, { isValid: false, invalidReason: "w1010_unpaid_matrix_refuses_verify" });
    }
    if (req.method === "POST" && path === "/settle") {
      calls.settle += 1;
      return send(400, { success: false, errorReason: "w1010_unpaid_matrix_refuses_settle" });
    }
    return send(404, { error: "unexpected_w1010_facilitator_request" });
  });
  await new Promise((resolveListen, reject) => {
    server.listen(0, "127.0.0.1", resolveListen);
    server.once("error", reject);
  });
  return {
    calls,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

export async function startLocalMerchant() {
  const facilitator = await startFakeFacilitator();
  const dataDir = await mkdtemp(join(tmpdir(), "w1010-amount-matrix-"));
  let child = null;
  try {
    const port = await unusedPort();
    const env = {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitator.url,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: SDS.origin,
      EXTRACT_BATCH_ENABLED: "",
      LOCKFILE_PIN_DELTA_ENABLED: "",
    };
    delete env.CDP_API_KEY_ID;
    delete env.CDP_API_KEY_SECRET;
    delete env.RECEIPT_SIGNING_PRIVATE_KEY;
    child = spawn(process.execPath, ["server.js"], {
      cwd: REPO_ROOT,
      env,
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
    const spawned = child;
    return {
      base: `http://127.0.0.1:${port}`,
      child: spawned,
      facilitator,
      output: () => output,
      async close() {
        await stopChild(spawned);
        await facilitator.close();
        await rm(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child) await stopChild(child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}
