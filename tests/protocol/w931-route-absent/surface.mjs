import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentDiscoverabilityAudit } from "../../../agent-discoverability-audit.mjs";
import { LOCKFILE_PIN_DELTA_PATH } from "../../../lockfile-pin-delta-config.mjs";
import { SDS } from "./constants.mjs";
import { REPO_ROOT } from "./paths.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function market8004Empty(query = SDS.intent) {
  return new Response(
    `<input name="q" value="${query}"><span>0</span><span>Assets found</span>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

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

function emptyCatalogBody(target) {
  if (target.includes("coinbase.com")) return jsonResponse({ resources: [] });
  if (target.includes("agent402.tools")) return jsonResponse({ results: [] });
  if (target.includes("agentic.market")) return jsonResponse({ services: [] });
  if (target.includes("circle.com")) return jsonResponse({ items: [] });
  if (target.includes("agentictrade.io")) return jsonResponse({ services: [] });
  if (target.includes("mpp.dev")) return jsonResponse({ services: [] });
  if (target.includes("mppscan.com")) return jsonResponse({ result: { data: { json: [] } } });
  if (target.includes("payanagent.com")) return jsonResponse({ offers: [] });
  if (target.includes("x402.jobs")) return jsonResponse({ resources: [] });
  if (target.includes("8004market.io")) return market8004Empty();
  return null;
}

export function createEmptyCatalogFetch() {
  return async (url) => {
    const target = String(url);
    const body = emptyCatalogBody(target);
    if (body) return body;
    throw new Error(`w931-route-absent blocked unexpected catalog URL: ${target}`);
  };
}

export function createOriginFoundCatalogFetch() {
  return async (url) => {
    const target = String(url);
    if (target.includes("coinbase.com") && target.includes("/discovery/search")) {
      return jsonResponse({
        resources: [{
          serviceName: "SameDayDesk extract",
          resource: `${SDS.origin}${SDS.extractPath}`,
          accepts: [{ amount: SDS.amountAtomic, payTo: SDS.payTo }],
        }],
      });
    }
    const body = emptyCatalogBody(target);
    if (body) return body;
    throw new Error(`w931-route-absent blocked unexpected catalog URL: ${target}`);
  };
}

async function refusePay() {
  throw new Error("w931-route-absent must not preflight, verify, or settle");
}

const AUDIT_INPUT = Object.freeze({
  origin: SDS.origin,
  intent: SDS.intent,
  route: SDS.lockfilePath,
  payTo: SDS.payTo,
  expectedPriceUsd: SDS.expectedPriceUsd,
});

export async function runEmptyCatalogAudit() {
  return agentDiscoverabilityAudit(AUDIT_INPUT, {
    fetchImpl: createEmptyCatalogFetch(),
    paymentPreflightImpl: refusePay,
    coinbaseMaterializationImpl: refusePay,
    now: 0,
  });
}

export async function runOriginFoundAudit() {
  return agentDiscoverabilityAudit(AUDIT_INPUT, {
    fetchImpl: createOriginFoundCatalogFetch(),
    paymentPreflightImpl: refusePay,
    coinbaseMaterializationImpl: refusePay,
    now: 0,
  });
}

async function startFakeFacilitator() {
  const calls = { settle: 0, supported: 0, verify: 0 };
  const server = createHttpServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/supported") {
      calls.supported += 1;
      return send(200, {
        kinds: [{ network: SDS.network, scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      });
    }
    if (req.method === "POST" && req.url === "/verify") {
      calls.verify += 1;
      throw new Error("w931-route-absent must not verify");
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      throw new Error("w931-route-absent must not settle");
    }
    return send(404, { error: "unexpected_test_facilitator_request" });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    calls,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
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
  };
}

export async function withMerchantFlagOff(fn) {
  const dataDir = await mkdtemp(join(tmpdir(), "w931-route-absent-"));
  const facilitator = await startFakeFacilitator();
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitator.url,
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
      EXTRACT_BATCH_ENABLED: "0",
      PUBLIC_URL: SDS.origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 25_000);
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
    const origin = `http://127.0.0.1:${port}`;
    const session = {
      origin,
      facilitator: facilitator.calls,
      output: () => output,
      async get(path) {
        const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(8_000) });
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        return { status: response.status, json, text, ...headerObservation(response) };
      },
      async post(path, body) {
        const response = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8_000),
        });
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        return { status: response.status, json, text, ...headerObservation(response) };
      },
    };
    return await fn(session);
  } finally {
    await stopChild(child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

export async function probeMerchantFlagOff(session) {
  const emptyLock = { lockfileVersion: 3, packages: {} };
  const [lockfile, extract, openapi, actions, manifest] = await Promise.all([
    session.post(LOCKFILE_PIN_DELTA_PATH, { before: emptyLock, after: emptyLock }),
    session.get(`${SDS.extractPath}?url=${encodeURIComponent("https://example.com")}`),
    session.get("/openapi.json"),
    session.get("/api/actions"),
    session.get("/.well-known/x402"),
  ]);
  return {
    httpStatus: lockfile.status,
    headers: lockfile.headers,
    headerNames: lockfile.headerNames,
    hasPaymentRequiredHeader: lockfile.hasPaymentRequiredHeader,
    charged: lockfile.json?.charged === true,
    challenge: lockfile.status === 402,
    extractHttpStatus: extract.status,
    advertisedOpenApi: Boolean(openapi.json?.paths?.[LOCKFILE_PIN_DELTA_PATH]),
    advertisedActions: Array.isArray(actions.json?.actions)
      && actions.json.actions.some((action) => action.route === LOCKFILE_PIN_DELTA_PATH),
    advertisedWellKnown: Array.isArray(manifest.json?.items)
      && manifest.json.items.some((item) => item.resource?.routeTemplate === LOCKFILE_PIN_DELTA_PATH),
    facilitatorVerify: session.facilitator.verify,
    facilitatorSettle: session.facilitator.settle,
    paymentSignatureSent: false,
    path: LOCKFILE_PIN_DELTA_PATH,
  };
}
