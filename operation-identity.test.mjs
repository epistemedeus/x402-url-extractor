import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPaidActionSkills } from "./a2a-storefront.mjs";
import { buildX402ManifestItems } from "./construction-surface.mjs";
import {
  entriesFromSurfaces,
  identityProblems,
  operationIdentity,
} from "./operation-identity.mjs";

const extract = {
  name: "extract",
  method: "GET",
  route: "/extract",
  url: "https://agents.example/extract",
  priceAtomicUsdc: "5000",
  description: "Extract",
  mimeType: "application/json",
  request: { method: "GET", exampleUrl: "https://agents.example/extract?url=https%3A%2F%2Fexample.com" },
};
const batch = {
  name: "extract_batch",
  method: "POST",
  route: "/extract/batch",
  url: "https://agents.example/extract/batch",
  priceAtomicUsdc: "10000",
  description: "Batch",
  mimeType: "application/json",
};
const lockfile = {
  name: "lockfile-pin-delta",
  method: "POST",
  route: "/lockfile-pin-delta",
  url: "https://agents.example/lockfile-pin-delta",
  priceAtomicUsdc: "5000",
  description: "Lockfile",
  mimeType: "application/json",
};

function paymentInfo(action) {
  return {
    operation: operationIdentity({ route: action.route, priceAtomic: action.priceAtomicUsdc }),
    price: { amount: "0.01", currency: "USD", mode: "fixed" },
    protocols: action.route === "/lockfile-pin-delta"
      ? [{ x402: { scheme: "exact" } }]
      : [{ x402: { scheme: "exact" } }, { mpp: { method: "evm" } }],
  };
}

test("projectors advertise one identity for extract, batch, and lockfile", () => {
  const actions = [extract, batch, lockfile];
  const manifestItems = buildX402ManifestItems({
    resources: actions.map((action) => ({ url: action.url, amount: action.priceAtomicUsdc, description: action.description, mimeType: action.mimeType })),
    actions,
    acceptsFor: (amount) => [{ amount }],
    alternate: {
      route: "/gateway/commerce/payment-offer-preflight",
      url: "https://agents.example/gateway/commerce/payment-offer-preflight",
      description: "same preflight",
      mimeType: "application/json",
      accepts: [{ amount: "5000" }],
      request: null,
    },
  });
  assert.equal(manifestItems[3].identity, undefined);
  const skills = buildPaidActionSkills(actions);
  const openapi = {
    paths: {
      "/extract": { get: { "x-payment-info": paymentInfo(extract) } },
      "/extract/batch": {
        get: { "x-payment-info": paymentInfo(batch) },
        post: { "x-payment-info": paymentInfo(batch) },
      },
      "/lockfile-pin-delta": { post: { "x-payment-info": paymentInfo(lockfile) } },
      "/gateway/commerce/payment-offer-preflight": {
        get: { "x-payment-info": { price: { amount: "0.005" }, protocols: [{ x402: { settlement: "circle-gateway-batched" } }] } },
      },
    },
  };
  const mcpTools = actions.map((action) => ({
    name: action.name,
    _meta: { x402: { paymentRequired: true, accepts: [{ amount: action.priceAtomicUsdc }] }, samedaydesk: { operation: operationIdentity(action.route === "/extract" ? { route: action.route, priceAtomic: action.priceAtomicUsdc } : { route: action.route, priceAtomic: action.priceAtomicUsdc }) } },
  }));
  const entries = entriesFromSurfaces({ mcpTools, manifestItems, skills, openapi });
  assert.deepEqual(identityProblems(entries), []);
  assert.equal(operationIdentity({ route: "/extract/batch", priceAtomic: "10000" }).billingBasis, "per-bounded-attempt");
  assert.deepEqual(operationIdentity({ route: "/lockfile-pin-delta", priceAtomic: "5000" }).supportedRails, ["x402"]);
});

test("checker rejects batch sold as per successful call, lockfile on mpp, and an invented rail", () => {
  const batchSold = ["mcp", "manifest", "a2a", "openapi"].map((surface) => ({
    surface,
    identity: { id: "extract_batch", price: "10000", billingBasis: "per successful call", supportedRails: ["x402", "mpp"] },
  }));
  assert.ok(identityProblems(batchSold).some((problem) => problem.includes("batch-per-successful-call")));
  const lockfileMpp = [{
    surface: "openapi",
    identity: { id: "lockfile-pin-delta", price: "5000", billingBasis: "per-call", supportedRails: ["x402", "mpp"] },
  }];
  assert.ok(identityProblems(lockfileMpp).some((problem) => problem.includes("lockfile-not-x402-only")));
  const invented = [{
    surface: "mcp",
    identity: { id: "extract", price: "5000", billingBasis: "per-call", supportedRails: ["x402", "stripe"] },
  }];
  assert.ok(identityProblems(invented).some((problem) => problem.includes("invented-rail:stripe")));
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

test("live merchant projects one identity across MCP, manifest, A2A, and OpenAPI", async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = await mkdtemp(path.join(tmpdir(), "operation-identity-"));
  const facilitator = createHttpServer((req, res) => {
    const body = req.url === "/supported"
      ? { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} }
      : { error: "unexpected" };
    res.writeHead(req.url === "/supported" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  const facilitatorPort = await new Promise((resolve, reject) => {
    facilitator.listen(0, "127.0.0.1", () => resolve(facilitator.address().port));
    facilitator.once("error", reject);
  });
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: `http://127.0.0.1:${facilitatorPort}`,
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      EXTRACT_BATCH_ENABLED: "1",
      LOCKFILE_PIN_DELTA_ENABLED: "1",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-1500)}`)), 20000);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-20000);
        if (output.includes(`MCP server:  POST /mcp`)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`exited ${code}: ${output.slice(-1500)}`));
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const [manifest, openapi, mpp, card] = await Promise.all([
      fetch(`${origin}/.well-known/x402`).then((response) => response.json()),
      fetch(`${origin}/openapi.json`).then((response) => response.json()),
      fetch(`${origin}/mpp-openapi.json`).then((response) => response.json()),
      fetch(`${origin}/.well-known/agent-card.json`).then((response) => response.json()),
    ]);
    const listed = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "identity", version: "1" } },
      }),
    });
    const session = listed.headers.get("mcp-session-id");
    const toolsResponse = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const toolsText = await toolsResponse.text();
    const toolsPayload = JSON.parse(toolsText.split("\n").filter((line) => line.startsWith("data:")).at(-1)?.replace(/^data:\s?/, "") || toolsText);
    const batchTool = toolsPayload.result.tools.find((tool) => tool.name === "extract_batch");
    assert.ok(batchTool, `tools: ${(toolsPayload.result.tools || []).map((tool) => tool.name).join(",")}`);
    assert.ok(batchTool._meta?.samedaydesk?.operation, JSON.stringify(batchTool._meta));
    const entries = entriesFromSurfaces({
      mcpTools: toolsPayload.result.tools,
      manifestItems: manifest.items,
      skills: card.skills,
      openapi,
    });
    assert.deepEqual(identityProblems(entries), []);
    const batch = entries.filter((entry) => entry.identity.id === "extract_batch");
    assert.deepEqual(batch.map((entry) => entry.surface).sort(), ["a2a", "manifest", "mcp", "openapi"]);
    assert.ok(batch.every((entry) => entry.identity.billingBasis === "per-bounded-attempt" && entry.identity.price === "10000"));
    const lockfileEntries = entries.filter((entry) => entry.identity.id === "lockfile-pin-delta");
    assert.ok(lockfileEntries.every((entry) => entry.identity.supportedRails.join(",") === "x402" && entry.identity.price === "5000"));
    assert.equal(mpp.paths["/lockfile-pin-delta"], undefined);
    assert.equal(mpp.paths["/extract/batch"].post["x-payment-info"].operation.billingBasis, "per-bounded-attempt");
    assert.equal(openapi.paths["/gateway/commerce/payment-offer-preflight"].get["x-payment-info"].operation, undefined);
  } finally {
    child.kill("SIGTERM");
    facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
