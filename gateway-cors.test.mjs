import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";

import {
  BROWSER_AGENT_CORS_ALLOW_HEADERS,
  BROWSER_AGENT_CORS_ALLOW_METHODS,
  BROWSER_AGENT_CORS_ALLOW_ORIGIN,
  BROWSER_AGENT_CORS_MAX_AGE,
  BROWSER_AGENT_CORS_PATHS,
  GATEWAY_PAYMENT_EXPOSE_HEADERS,
  browserAgentCorsMiddleware,
  createBrowserAgentCorsPolicy,
  isBrowserAgentCorsPath,
} from "./gateway-cors.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

test("browser agent CORS paths are the gateway discovery surfaces only", () => {
  assert.deepEqual(BROWSER_AGENT_CORS_PATHS, [
    "/mcp",
    "/.well-known/agent-card.json",
    "/.well-known/agent.json",
    "/openapi.json",
    "/llms.txt",
    "/skill.md",
    "/.well-known/x402",
  ]);
  assert.equal(isBrowserAgentCorsPath("/mcp"), true);
  assert.equal(isBrowserAgentCorsPath("/mcp?x=1"), true);
  assert.equal(isBrowserAgentCorsPath("/SKILL.md"), false);
  assert.equal(isBrowserAgentCorsPath("/.well-known/x402.json"), false);
  assert.equal(isBrowserAgentCorsPath("/extract"), false);
  assert.equal(isBrowserAgentCorsPath("/mcp/extra"), false);
});

test("seeded credentialed wildcard is rejected", () => {
  assert.throws(
    () => createBrowserAgentCorsPolicy({ allowCredentials: true }),
    /refusing Access-Control-Allow-Credentials with Access-Control-Allow-Origin \*/,
  );
  const policy = createBrowserAgentCorsPolicy();
  assert.equal(policy.allowOrigin, "*");
  assert.equal(policy.allowCredentials, false);
  assert.equal(policy.allowMethods, "GET, POST, OPTIONS");
  assert.equal(policy.allowHeaders, "content-type");
  assert.equal(policy.maxAge, "86400");
  for (const name of ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"]) {
    assert.equal(policy.exposeHeaders.includes(name), true, name);
  }
});

test("preflight is 204 and a later credentials header is dropped", async () => {
  const app = express();
  app.use(browserAgentCorsMiddleware);
  app.use((req, res) => {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("PAYMENT-REQUIRED", "challenge");
    res.status(402).json({ ok: false });
  });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const preflight = await fetch(`${base}/openapi.json`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://browser.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(await preflight.text(), "");
    assert.equal(preflight.headers.get("access-control-allow-origin"), BROWSER_AGENT_CORS_ALLOW_ORIGIN);
    assert.equal(preflight.headers.get("access-control-allow-methods"), BROWSER_AGENT_CORS_ALLOW_METHODS);
    assert.equal(preflight.headers.get("access-control-allow-headers"), BROWSER_AGENT_CORS_ALLOW_HEADERS);
    assert.equal(preflight.headers.get("access-control-max-age"), BROWSER_AGENT_CORS_MAX_AGE);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    assert.equal(preflight.headers.get("access-control-expose-headers").includes("PAYMENT-REQUIRED"), true);

    const paid = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(paid.status, 402);
    assert.equal(paid.headers.get("payment-required"), "challenge");
    assert.equal(paid.headers.get("access-control-allow-origin"), "*");
    assert.equal(paid.headers.get("access-control-allow-credentials"), null);
    for (const name of GATEWAY_PAYMENT_EXPOSE_HEADERS) {
      assert.equal(paid.headers.get("access-control-expose-headers").includes(name), true, name);
    }

    const other = await fetch(`${base}/extract`, { method: "OPTIONS" });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
    assert.notEqual(other.status, 204);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("live gateway preflight, discovery GET, and unpaid 402 stay intact", { timeout: 60_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-gateway-cors-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 20_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`) || !output.includes("MCP server:  POST /mcp")) return;
      clearTimeout(timer);
      resolve(true);
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
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  assert.equal(await listening, true);
  const base = `http://127.0.0.1:${port}`;

  for (const route of BROWSER_AGENT_CORS_PATHS) {
    const preflight = await fetch(`${base}${route}`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204, route);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type");
    assert.equal(preflight.headers.get("access-control-max-age"), "86400");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null, route);
    const exposed = preflight.headers.get("access-control-expose-headers") || "";
    assert.equal(exposed.includes("PAYMENT-REQUIRED"), true, route);
    assert.equal(exposed.includes("X-PAYMENT-RESPONSE"), true, route);
    assert.equal(exposed.includes("PAYMENT-RESPONSE"), true, route);
  }

  const card = await fetch(`${base}/.well-known/agent-card.json`);
  assert.equal(card.status, 200);
  assert.equal(card.headers.get("access-control-allow-origin"), "*");
  assert.equal(card.headers.get("access-control-allow-credentials"), null);
  const body = await card.json();
  assert.equal(typeof body.name, "string");

  const challenge = await fetch(`${base}/extract?url=https%3A%2F%2Fexample.com`);
  assert.equal(challenge.status, 402);
  assert.ok(challenge.headers.get("payment-required"));
  assert.equal(challenge.headers.get("access-control-allow-credentials"), null);

  const alias = await fetch(`${base}/.well-known/x402.json`, { method: "OPTIONS" });
  assert.equal(alias.headers.get("access-control-allow-origin"), null);

  const mcp = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(mcp.headers.get("access-control-allow-origin"), "*");
  assert.equal(mcp.headers.get("access-control-allow-credentials"), null);
  assert.notEqual(mcp.status, 204);
});
