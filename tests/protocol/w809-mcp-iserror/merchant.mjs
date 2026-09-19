import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SDS } from "./constants.mjs";
import { REPO_ROOT } from "./paths.mjs";

const MPP_SECRET = "test-secret-key-test-secret-key-32";
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

function decodeMcpBody(text, contentType) {
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payloads = String(text)
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .filter(Boolean);
    for (let index = payloads.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(payloads[index]);
      } catch {
        /* keep scanning */
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
      return send(500, { error: "w809 unpaid hop must not verify" });
    }
    if (req.method === "POST" && req.url === "/settle") {
      calls.settle += 1;
      return send(500, { error: "w809 unpaid hop must not settle" });
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
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startMerchant({ dataDir, facilitatorUrl }) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: SDS.origin,
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      EXTRACT_BATCH_ENABLED: "0",
      LOCKFILE_PIN_DELTA_ENABLED: "0",
      IDEMPOTENCY_INFLIGHT_WAIT_MS: "50",
      MPP_SECRET_KEY: MPP_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-40_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      if (!/MCP server:\s+POST \/mcp \(\d+ paid tools\)/.test(output)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { base: `http://127.0.0.1:${port}`, child, port };
}

export async function withProductionMerchant(fn) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "w809-mcp-iserror-"));
  const facilitator = await startFakeFacilitator();
  const merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });
  const session = {
    origin: merchant.base,
    snapshot() {
      return { settle: facilitator.calls.settle, verify: facilitator.calls.verify, handler: 0 };
    },
    async post(body) {
      const response = await fetch(`${merchant.base}/mcp`, {
        method: "POST",
        headers: { host: "agents.samedaydesk.com", ...MCP_HEADERS },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      return {
        status: response.status,
        json: decodeMcpBody(text, response.headers.get("content-type")),
        text,
        ...headerObservation(response),
      };
    },
  };
  try {
    return await fn(session);
  } finally {
    await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}
