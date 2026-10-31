import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PAGE_CHANGE_MCP_ANNOTATIONS, PAGE_CHANGE_MCP_PATH, PAGE_CHANGE_MCP_TOOL } from "../page-change-mcp.mjs";
import { exactOrigin, normalizeExpectedSource, receiveMerchantRelease } from "./merchant-release-receiving.mjs";

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "7138c170c7c5d06dae0568466b7a93b77439bbda";
const OTHER_SOURCE = "0000000000000000000000000000000000000000";

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
    res.writeHead(200, { "content-type": "application/json" });
    if (req.method === "GET" && req.url === "/supported") {
      res.end(JSON.stringify({
        kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    res.end(JSON.stringify({ isValid: false, success: false }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startMerchant({ enabled, source }) {
  const facilitator = await startFakeFacilitator();
  const dataDir = await mkdtemp(path.join(tmpdir(), "merchant-release-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(port),
      NETWORK: "eip155:8453",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitator.url,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      PAGE_CHANGE_HTTP_ENABLED: enabled ? "1" : "0",
      EXTRACTION_TRIAL_ENABLED: "0",
      SOURCE_COMMIT: source,
      PAGE_CHANGE_SOURCE_COMMIT: source,
      RAILWAY_GIT_COMMIT_SHA: "",
      NODE_OPTIONS: "--max-old-space-size=512",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const origin = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup timed out\n${output.slice(-2000)}`)), 20_000);
      const finish = (error) => {
        clearTimeout(timer);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve();
      };
      const onData = (chunk) => {
        output += chunk;
        if (output.includes(`x402-merchant listening on :${port}`)) finish();
      };
      const onExit = (code, signal) => finish(new Error(`startup exited ${code} ${signal}\n${output.slice(-2000)}`));
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", onExit);
    });
  } catch (error) {
    await stopChild(child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  return {
    origin,
    async close() {
      await stopChild(child);
      await facilitator.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

function recordingFetch(urls) {
  return async (url, options) => {
    urls.push(String(url));
    assert.equal(String(url).includes("agents.samedaydesk.com"), false);
    assert.equal(String(url).includes("/openapi.json"), false);
    return fetch(url, options);
  };
}

function jsonResponse(status, body, { allow = null } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (allow) headers.set("allow", allow);
  return new Response(JSON.stringify(body), { status, headers });
}

test("release receiver configuration never contacts a network", async () => {
  assert.equal(exactOrigin("https://agents.samedaydesk.com"), "https://agents.samedaydesk.com");
  assert.equal(exactOrigin("http://127.0.0.1:9/health"), null);
  assert.equal(normalizeExpectedSource(` ${SOURCE.toUpperCase()} `), SOURCE);
  assert.equal(normalizeExpectedSource("not-a-commit"), null);
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("network"); };
  for (const input of [
    {},
    { expectedSource: SOURCE },
    { origin: "http://127.0.0.1:9/extra", expectedSource: SOURCE },
    { origin: "http://127.0.0.1:9", expectedSource: "short" },
    { origin: "http://127.0.0.1:9", expectedSource: SOURCE, freeRoute: "mcp" },
    ...["/\\other.example/path", "//other.example/path", "/mcp?other=1", "/mcp#other", "/mcp/../paid", "/mcp\n"].map((freeRoute) => ({ origin: "http://127.0.0.1:9", expectedSource: SOURCE, freeRoute })),
  ]) {
    const result = await receiveMerchantRelease({ ...input, fetchImpl });
    assert.equal(result.ownerQa, true);
    assert.equal(result.ok, false);
    assert.equal(result.network, false);
    assert.equal(calls, 0);
  }
});

test("release receiver separates paid MPP availability from the free route", async () => {
  const origin = "http://127.0.0.1:9";
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push(`${options.method || "GET"} ${url}`);
    const route = new URL(url).pathname;
    if (route === "/recipes/page-change/health") {
      return jsonResponse(200, {
        ok: true, status: "ok", enabled: true, product: "samedaydesk-page-change-http",
        schemaVersion: "samedaydesk.page-change-http.v0", commit: SOURCE, commitStatus: "available",
      });
    }
    if (route === "/healthz") {
      return jsonResponse(200, { ok: true, paymentProtocols: { x402: { enabled: true }, mpp: { enabled: true, reason: null } } });
    }
    if (route === "/mpp-openapi.json") {
      const paid = requests.some((item) => item.includes("absent"))
        ? {}
        : { "/extract": { get: { "x-payment-info": { operation: { price: "5000" } }, responses: { "402": { description: "payment required" } } } } };
      return jsonResponse(200, { openapi: "3.1.0", paths: { ...paid, "/recipes/page-change": { post: { summary: "free" } } } });
    }
    if (options.method === "GET") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "POST" });
    return jsonResponse(500, { error: "unexpected" });
  };
  const connect = async () => ({
    client: {
      async listTools() {
        return { tools: [{ name: PAGE_CHANGE_MCP_TOOL, annotations: { ...PAGE_CHANGE_MCP_ANNOTATIONS } }] };
      },
      async callTool({ name }) {
        if (name === PAGE_CHANGE_MCP_TOOL) return { isError: false, content: [{ type: "text", text: "{}" }] };
        const error = new Error("MCP error -32602: Unknown tool");
        error.code = -32602;
        throw error;
      },
    },
    async close() {},
  });
  const present = await receiveMerchantRelease({ origin, expectedSource: SOURCE, fetchImpl, connect });
  assert.equal(present.ok, true, JSON.stringify(present.reasons));
  assert.deepEqual(present.checks.mppOpenApi.paidOperations, [{ method: "GET", path: "/extract" }]);
  assert.equal(present.checks.healthz.mppEnabled, true);
  assert.equal(present.checks.healthz.x402Enabled, true);
  assert.deepEqual(present.checks.freeSdk.refused.map((item) => item.name), ["extract", "trial_read"]);
  assert.equal(present.checks.freeSdk.refused.every((item) => item.accepted), true);
  assert.equal(requests.some((item) => item.includes("/openapi.json")), false);

  for (const enabled of [undefined, null, "false", "true", 0, 1]) {
    const unknown = await receiveMerchantRelease({
      origin, expectedSource: SOURCE, connect,
      fetchImpl: async (url, options) => {
        const route = new URL(url).pathname;
        if (route === "/healthz") return jsonResponse(200, { ok: true, paymentProtocols: { x402: { enabled: true }, mpp: { enabled } } });
        if (route === "/mpp-openapi.json") return jsonResponse(200, { openapi: "3.1.0", paths: {} });
        return fetchImpl(url, options);
      },
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "mpp_state_unknown");
    assert.equal(unknown.checks.healthz.mppEnabled, null);
  }

  const reorderedAnnotations = await receiveMerchantRelease({
    origin, expectedSource: SOURCE, fetchImpl,
    connect: async () => {
      const session = await connect();
      session.client.listTools = async () => ({ tools: [{ name: PAGE_CHANGE_MCP_TOOL, annotations: Object.fromEntries(Object.entries(PAGE_CHANGE_MCP_ANNOTATIONS).reverse()) }] });
      return session;
    },
  });
  assert.equal(reorderedAnnotations.ok, true, JSON.stringify(reorderedAnnotations.reasons));

  const absent = await receiveMerchantRelease({
    origin, expectedSource: SOURCE, fetchImpl: async (url, options) => {
      requests.push(`absent ${url}`);
      return fetchImpl(url, options);
    }, connect,
  });
  assert.equal(absent.ok, false);
  assert.equal(absent.reason, "mpp_paid_operations_absent");

  const wrongTools = await receiveMerchantRelease({
    origin, expectedSource: SOURCE, fetchImpl, connect: async () => ({
      client: { async listTools() { return { tools: [{ name: "extract" }, { name: "read" }] }; }, async callTool() { throw new Error("paid"); } },
      async close() {},
    }),
  });
  assert.equal(wrongTools.ok, false);
  assert.equal(wrongTools.checks.freeSdk.reason, "free_route_tools");

  let freeHits = 0;
  const dropped = await receiveMerchantRelease({
    origin, expectedSource: SOURCE, connect,
    fetchImpl: async (url, options) => {
      const route = new URL(url).pathname;
      if (route === PAGE_CHANGE_MCP_PATH) {
        freeHits += 1;
        throw new Error("socket closed");
      }
      if (route === "/mpp-openapi.json") {
        return jsonResponse(200, {
          openapi: "3.1.0",
          paths: { "/extract": { get: { "x-payment-info": { operation: { price: "5000" } } } } },
        });
      }
      return fetchImpl(url, options);
    },
  });
  assert.equal(dropped.network, true);
  assert.equal(dropped.ok, false);
  assert.equal(dropped.reason, "free_route_transport");
  assert.equal(freeHits, 1);
  assert.equal(dropped.checks.pageChangeHealth.commit, SOURCE);
});

test("mounted release receiver covers source, route, refusal, disabled, and recovery", { timeout: 90_000 }, async () => {
  const urls = [];
  const fetchImpl = recordingFetch(urls);
  const enabled = await startMerchant({ enabled: true, source: SOURCE });
  try {
    const matched = await receiveMerchantRelease({ origin: enabled.origin, expectedSource: SOURCE, fetchImpl });
    assert.equal(matched.ownerQa, true);
    assert.equal(matched.ok, true, JSON.stringify(matched));
    assert.equal(matched.checks.pageChangeHealth.commit, SOURCE);
    assert.equal(matched.checks.pageChangeHealth.product, "samedaydesk-page-change-http");
    assert.equal(matched.checks.pageChangeHealth.schemaVersion, "samedaydesk.page-change-http.v0");
    assert.equal(matched.checks.healthz.x402Enabled, true);
    assert.equal(matched.checks.healthz.mppEnabled, false);
    assert.deepEqual(matched.checks.mppOpenApi.paidOperations, []);
    assert.equal(matched.checks.freeSdk.tool, PAGE_CHANGE_MCP_TOOL);
    assert.deepEqual(matched.checks.freeSdk.annotations, PAGE_CHANGE_MCP_ANNOTATIONS);
    assert.equal(matched.checks.freeSdk.authorizationSent, false);
    assert.equal(matched.checks.freeSdk.disabledCall, null);
    assert.deepEqual(matched.checks.freeSdk.refused.map((item) => [item.name, item.accepted, item.code]), [
      ["extract", true, -32602],
      ["trial_read", true, -32602],
    ]);

    const wrongSource = await receiveMerchantRelease({ origin: enabled.origin, expectedSource: OTHER_SOURCE, fetchImpl });
    assert.equal(wrongSource.ok, false);
    assert.equal(wrongSource.reason, "source_mismatch");
    assert.equal(wrongSource.checks.pageChangeHealth.commit, SOURCE);

    for (const freeRoute of ["/health", "/mcp"]) {
      const wrongRoute = await receiveMerchantRelease({ origin: enabled.origin, expectedSource: SOURCE, freeRoute, fetchImpl });
      assert.equal(wrongRoute.ok, false, freeRoute);
      assert.equal(wrongRoute.checks.freeSdk.reason, "free_route_method", freeRoute);
      assert.notEqual(wrongRoute.checks.freeSdk.getStatus, 405, freeRoute);
    }

    const closed = await unusedPort();
    const missing = await receiveMerchantRelease({ origin: `http://127.0.0.1:${closed}`, expectedSource: SOURCE, fetchImpl });
    assert.equal(missing.network, true);
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "origin_unreachable");

    const cli = spawnSync(process.execPath, ["scripts/merchant-release-receiving.mjs", "--origin", enabled.origin, "--expected-source", SOURCE], {
      cwd, encoding: "utf8", timeout: 20_000,
    });
    assert.equal(cli.status, 0, cli.stderr);
    const cliResult = JSON.parse(cli.stdout);
    assert.equal(cliResult.ok, true);
    assert.equal(cliResult.ownerQa, true);
    assert.equal(cliResult.checks.healthz.mppEnabled, false);
    assert.deepEqual(cliResult.checks.mppOpenApi.paidOperations, []);
  } finally {
    await enabled.close();
  }

  const disabled = await startMerchant({ enabled: false, source: SOURCE });
  try {
    const dark = await receiveMerchantRelease({ origin: disabled.origin, expectedSource: SOURCE, fetchImpl });
    assert.equal(dark.ok, false);
    assert.equal(dark.reason, "page_change_http_disabled");
    assert.equal(dark.checks.pageChangeHealth.httpStatus, 404);
    assert.equal(dark.checks.pageChangeHealth.commit, null);
    assert.equal(Object.hasOwn(dark.checks.pageChangeHealth, "commit"), true);
    assert.equal(dark.checks.freeSdk.disabledCall, "page_change_http_disabled");
    assert.equal(dark.checks.healthz.mppEnabled, false);
    assert.deepEqual(dark.checks.mppOpenApi.paidOperations, []);
    assert.equal(dark.checks.freeSdk.refused.every((item) => item.accepted), true);
  } finally {
    await disabled.close();
  }

  const recovered = await startMerchant({ enabled: true, source: SOURCE });
  try {
    const again = await receiveMerchantRelease({ origin: recovered.origin, expectedSource: SOURCE, fetchImpl });
    assert.equal(again.ok, true, JSON.stringify(again.reasons));
    assert.equal(again.checks.pageChangeHealth.commit, SOURCE);
    assert.equal(again.checks.freeSdk.tool, PAGE_CHANGE_MCP_TOOL);
  } finally {
    await recovered.close();
  }
  assert.equal(urls.some((url) => url.includes("/openapi.json")), false);
  assert.equal(urls.some((url) => url.includes("/healthz")), true);
  assert.equal(urls.some((url) => url.includes("/mpp-openapi.json")), true);
  assert.equal(urls.some((url) => url.includes("/recipes/page-change/health")), true);
});

test("release receiver command refuses a missing origin", () => {
  const cli = spawnSync(process.execPath, ["scripts/merchant-release-receiving.mjs"], { cwd, encoding: "utf8" });
  assert.equal(cli.status, 2);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.network, false);
  assert.equal(result.reason, "missing_origin");
  assert.equal(result.ownerQa, true);
});
