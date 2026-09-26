import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { MATRIX_ROUTES, SDS } from "./constants.mjs";
import { decodePaymentRequiredHeader, extractOpenApiPriceUsd } from "./classify.mjs";
import { REPO_ROOT } from "./paths.mjs";

const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

export async function startFakeFacilitator() {
  const calls = { supported: 0, verify: 0, settle: 0, other: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: SDS.network, scheme: SDS.scheme, x402Version: SDS.x402Version }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      return send(500, { error: "w910-amount-matrix must not verify" });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(500, { error: "w910-amount-matrix must not settle" });
    }
    calls.other += 1;
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    close: () => closeServer(server),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stopChild(child) {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

function decodeMcpBody(text, contentType) {
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payload = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("");
    if (!payload) return null;
    return JSON.parse(payload);
  }
  return JSON.parse(text);
}

function headerObservation(response) {
  const headers = {};
  const headerNames = [];
  for (const [key, value] of response.headers.entries()) {
    const name = String(key).toLowerCase();
    headerNames.push(name);
    headers[name] = value;
  }
  return {
    headers,
    headerNames,
    hasPaymentRequiredHeader: headerNames.includes("payment-required"),
    paymentRequiredHeader: headers["payment-required"] || null,
  };
}

function pathnameOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return typeof url === "string" ? url : null;
  }
}

function firstAccept(container) {
  const accepts = Array.isArray(container?.accepts) ? container.accepts : [];
  return accepts[0] && typeof accepts[0] === "object" ? accepts[0] : null;
}

async function startMerchant({ dataDir, facilitatorUrl }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: SDS.origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`startup timed out: ${output.slice(-2000)}`)),
      30_000,
    );
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      if (!output.includes("MCP server:  POST /mcp")) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", reject);
  });
  return { base: `http://127.0.0.1:${port}`, child, output: () => output, port };
}

async function postMcp(origin, body) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = decodeMcpBody(text, response.headers.get("content-type"));
  } catch {
    json = null;
  }
  return {
    status: response.status,
    json,
    text,
    ...headerObservation(response),
  };
}

async function probeHttp(origin, route) {
  const response = await fetch(`${origin}${route.probePath}`, {
    method: route.httpMethod,
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const headers = headerObservation(response);
  const challenge = decodePaymentRequiredHeader(headers.paymentRequiredHeader)
    || (body && Array.isArray(body.accepts) ? body : null);
  const accept = firstAccept(challenge);
  return {
    method: route.httpMethod,
    path: route.httpPath,
    probePath: route.probePath,
    httpStatus: response.status,
    ...headers,
    body,
    challenge,
    amount: accept?.amount ?? null,
    maxAmountRequired: accept?.maxAmountRequired ?? null,
    payTo: accept?.payTo ?? null,
    network: accept?.network ?? null,
    asset: accept?.asset ?? null,
  };
}

function mcpToolObservation(listed, route) {
  const tools = Array.isArray(listed.json?.result?.tools) ? listed.json.result.tools : [];
  const tool = tools.find((entry) => entry?.name === route.mcpTool) || null;
  const x402 = tool?._meta?.x402 || null;
  const accept = firstAccept(x402);
  return {
    httpStatus: listed.status,
    tool: route.mcpTool,
    toolPresent: Boolean(tool),
    paymentRequired: x402?.paymentRequired === true,
    x402,
    amount: accept?.amount ?? null,
    payTo: accept?.payTo ?? null,
    network: accept?.network ?? null,
    asset: accept?.asset ?? null,
    hasPaymentRequiredHeader: listed.hasPaymentRequiredHeader,
    headerNames: listed.headerNames,
  };
}

function openapiObservation(document, route) {
  const operation = document?.paths?.[route.openapiPath]?.[route.openapiMethod];
  const description402 = operation?.responses?.["402"]?.description ?? null;
  return {
    present: Boolean(operation),
    path: route.openapiPath,
    method: route.openapiMethod,
    httpStatus: 200,
    description402,
    priceUsd: extractOpenApiPriceUsd(description402),
  };
}

function wellKnownObservation(manifest, route) {
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const item = items.find((entry) => (
    entry?.resource?.routeTemplate === route.httpPath
    || pathnameOf(entry?.resource?.url) === route.httpPath
  )) || null;
  const accept = firstAccept(item);
  return {
    present: Boolean(item),
    amount: accept?.amount ?? null,
    payTo: accept?.payTo ?? null,
    network: accept?.network ?? null,
    asset: accept?.asset ?? null,
  };
}

export async function withUnpaidAmountMatrixSurface(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") {
      throw new Error(`external network blocked: ${url.origin}`);
    }
    return originalFetch(input, init);
  };

  const dataDir = await mkdtemp(path.join(tmpdir(), "w910-amount-matrix-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  try {
    merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
    const origin = merchant.base;
    const [openapi, wellKnown] = await Promise.all([
      fetch(`${origin}/openapi.json`, { signal: AbortSignal.timeout(8_000) }).then((response) => {
        if (!response.ok) throw new Error(`openapi.json HTTP ${response.status}`);
        return response.json();
      }),
      fetch(`${origin}/.well-known/x402`, { signal: AbortSignal.timeout(8_000) }).then((response) => {
        if (!response.ok) throw new Error(`well-known x402 HTTP ${response.status}`);
        return response.json();
      }),
    ]);

    const initialized = await postMcp(origin, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "w910-amount-matrix", version: "1.0.0" },
      },
    });
    const listed = await postMcp(origin, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const httpById = {};
    for (const route of MATRIX_ROUTES) {
      httpById[route.id] = await probeHttp(origin, route);
    }

    const session = {
      origin,
      facilitator: facilitator.calls,
      snapshot: () => ({
        handler: 0,
        verify: facilitator.calls.verify,
        settle: facilitator.calls.settle,
        supported: facilitator.calls.supported,
      }),
      openapi,
      wellKnown,
      initialized,
      listed,
      httpById,
      routes: MATRIX_ROUTES.map((route) => ({
        id: `cold-${route.id}`,
        expect: "pass",
        kind: "route-amount-matrix",
        routeId: route.id,
        request: {
          method: route.httpMethod,
          path: route.probePath,
          paymentSignatureSent: false,
        },
        observation: {
          http: httpById[route.id],
          mcp: mcpToolObservation(listed, route),
          openapi: openapiObservation(openapi, route),
          wellKnown: wellKnownObservation(wellKnown, route),
        },
        claims: {
          charged: false,
          paidDelivery: false,
          successProven: false,
          settlement: false,
          treatAbsenceAsDemand: false,
        },
        counters: {
          handler: 0,
          verify: facilitator.calls.verify,
          settle: facilitator.calls.settle,
        },
      })),
    };

    return await fn(session);
  } finally {
    globalThis.fetch = originalFetch;
    await stopChild(merchant?.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}
