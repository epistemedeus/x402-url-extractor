import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listDeclaredAgentDiscoverySources } from "./commerce-events.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));

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

async function startFakeFacilitator() {
  const server = createHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "facilitator must not receive an unpaid request" }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function startMerchant({ dataDir, facilitatorUrl, startupTimeout = 20_000,
  command = process.execPath, args = ["server.js"], onSpawn = () => {} }) {
  const port = await unusedPort();
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitatorUrl,
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      EXTRACT_BATCH_ENABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  onSpawn(child);
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new Error(`startup timed out: ${output.slice(-2000)}`)), startupTimeout);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-20_000);
        if (!output.includes(`x402-merchant listening on :${port}`) || !output.includes("MCP server:  POST /mcp")) return;
        finish();
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const onExit = (code, signal) => finish(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
      const onError = (error) => finish(error);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return { base: `http://127.0.0.1:${port}`, child };
}

async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000).unref();
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

async function readEvents(dataDir, { minTotal = 0, minExtract = 0 } = {}) {
  const file = path.join(dataDir, "commerce-events.ndjson");
  const deadline = Date.now() + 5_000;
  let last = [];
  while (Date.now() < deadline) {
    try {
      const text = await readFile(file, "utf8");
      last = text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
      const extract = last.filter((row) => row.route === "/extract");
      if (last.length >= minTotal && extract.length >= minExtract) {
        return { all: last, extract };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected >=${minTotal} events and >=${minExtract} extract rows, got ${last.length}`);
}

test("startup timeout, early exit and spawn error leave no diagnostic child", { timeout: 10_000 }, async () => {
  for (const options of [
    { args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], startupTimeout: 500 },
    { args: ["-e", "process.exit(19)"] },
    { command: "/nonexistent-c26-test-node" },
  ]) {
    let child;
    await assert.rejects(startMerchant({ ...options, onSpawn: (value) => { child = value; } }));
    if (child.pid) {
      assert.ok(child.exitCode !== null || child.signalCode !== null);
      assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
    }
  }
});

test("mounted HTTP and MCP batch bridge retain runtime labels; initialize does not", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-runtime-source-"));
  const facilitator = await startFakeFacilitator();
  let merchant;
  t.after(async () => {
    if (merchant) await stopChild(merchant.child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  merchant = await startMerchant({ dataDir, facilitatorUrl: facilitator.url });

  const catalog = await fetch(`${merchant.base}/api/actions`).then((response) => response.json());
  const allowed = listDeclaredAgentDiscoverySources().map(({ value }) => value);
  assert.deepEqual(catalog.acquisition.declaredSourceHeader.allowedValues, allowed);
  assert.equal(allowed.includes("claude-code-marketplace-v1"), true);
  assert.equal(allowed.includes("goose-native-v1"), true);

  const extract = "/extract?url=https%3A%2F%2Fexample.com";
  const claude = await fetch(`${merchant.base}${extract}`, {
    headers: { "x-samedaydesk-agent-source": "claude-code-marketplace-v1" },
  });
  const goose = await fetch(`${merchant.base}${extract}`, {
    headers: { "x-samedaydesk-agent-source": "goose-native-v1" },
  });
  const unknown = await fetch(`${merchant.base}${extract}`, {
    headers: { "x-samedaydesk-agent-source": "not-a-runtime-v1" },
  });
  assert.equal(claude.status, 402);
  assert.equal(goose.status, 402);
  assert.equal(unknown.status, 402);

  const httpRows = await readEvents(dataDir, { minExtract: 3 });
  const bySource = Object.fromEntries(
    httpRows.extract.map((row) => [row.declaredAgentDiscoverySource, row]),
  );
  assert.equal(bySource["claude-code-marketplace"].discoverySourceKind, "declared_header");
  assert.equal(bySource["goose-native"].discoverySourceKind, "declared_header");
  assert.equal(bySource[null].declaredAgentDiscoverySource, null);
  assert.equal(httpRows.all.every((row) => !JSON.stringify(row).includes("claude-code-marketplace-v1")), true);
  assert.equal(httpRows.all.every((row) => !JSON.stringify(row).includes("goose-native-v1")), true);

  const beforeCount = httpRows.all.length;
  const mcp = await fetch(`${merchant.base}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "x-samedaydesk-agent-source": "claude-code-marketplace-v1",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "c26-runtime-source", version: "1" },
      },
    }),
  });
  assert.ok(mcp.status === 200 || mcp.status === 202);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterRows = await readEvents(dataDir, { minTotal: beforeCount, minExtract: 3 });
  assert.equal(afterRows.all.length, beforeCount);
  assert.equal(afterRows.all.every((row) => row.route !== "/mcp"), true);

  // The installed clients send headers to /mcp. Exercise the actual paidHttp
  // projection, including concurrent requests and an unknown label, unpaid.
  const labels = [" CLAUDE-CODE-MARKETPLACE-V1 ", "goose-native-v1", "unknown-runtime-v1"];
  const calls = await Promise.all(labels.map(async (label, index) => {
    const response = await fetch(`${merchant.base}/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json",
        "x-samedaydesk-agent-source": label, "x-samedaydesk-internal": "spoofed-owner-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 10 + index, method: "tools/call",
        params: { name: "extract_batch", arguments: { urls: ["https://example.com"] } } }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    const result = text.startsWith("data:") || text.includes("\ndata:")
      ? JSON.parse(text.split("\n").find((line) => line.startsWith("data:")).slice(5))
      : JSON.parse(text);
    assert.equal(result.result._meta["samedaydesk/http"].status, 402);
    assert.equal(result.result.isError, true);
  }));
  assert.equal(calls.length, 3);
  const bridged = await readEvents(dataDir, { minTotal: beforeCount + 3, minExtract: 3 });
  // The combined writer names the exact route; the HTTP hop owns attribution.
  const batches = bridged.all.filter((row) => row.route === "/extract/batch");
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((row) => row.declaredAgentDiscoverySource).sort(),
    ["claude-code-marketplace", "goose-native", null].sort());
  for (const row of batches) {
    assert.equal(row.status, 402);
    assert.equal(row.kind, "paid");
    assert.equal(row.matched, true);
    assert.notEqual(row.originClass, "internal");
    assert.equal(row.discoverySourceKind, row.declaredAgentDiscoverySource ? "declared_header" : "none");
  }
  assert.doesNotMatch(JSON.stringify(bridged.all), /claude-code-marketplace-v1|goose-native-v1|unknown-runtime-v1|spoofed-owner-token/);
});
