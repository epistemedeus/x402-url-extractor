// Source-bound dependency regression for merchant 360fa586 / 1.23.55.
// These checks use local libraries, the preserved audit, and the lockfile.
// They do not settle a payment or prove live-fund correctness.
import assert from "node:assert/strict";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import express from "express";
import fastUri from "fast-uri";
import proxyaddr from "proxy-addr";
import qs from "qs";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFacilitatorConfig } from "@coinbase/x402";
import { PaymentRequiredV2Schema } from "@x402/core/schemas";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  COINBASE_X402_POSTINSTALL_SHA256,
  FINDINGS,
  ORIGINAL_AUDIT_COUNTS,
  ORIGINAL_AUDIT_SHA256,
  REVIEWED_REMAINDER,
  REVIEWED_SOURCE,
  advisoryUrl,
  assertInapplicableImportsStayUncalled,
  assertPostinstallNotice,
  assertReviewedClosure,
  loadOriginalAudit,
  merchantProductionImports,
  requireOriginalClassification,
} from "./dependency-risk.mjs";
import { MCP_SERVER_INPUT_LIMITS, MCP_TOOL_INPUT_ELEMENT_CEILING } from "./mcp-tool-input-ceiling.mjs";
import { LOCKFILE_PIN_DELTA_MAX_JSON_NODES } from "./lockfile-pin-delta-config.mjs";
import { createMppDualStack } from "./mpp-dual-stack.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function read(relative) {
  return readFileSync(path.join(root, relative), "utf8");
}

function listen(app) {
  const server = createHttpServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
    server.once("error", reject);
  });
}

function request({ port, method = "GET", path: requestPath = "/", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: "127.0.0.1",
      port,
      method,
      path: requestPath,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

test("preserved 360fa586 audit stays byte-identical and fully classified", () => {
  const bytes = readFileSync(path.join(root, "dependency-risk/audit-360fa586.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), ORIGINAL_AUDIT_SHA256);
  const audit = loadOriginalAudit(root);
  assert.deepEqual(audit.metadata.vulnerabilities, ORIGINAL_AUDIT_COUNTS);
  assert.equal(Object.keys(audit.vulnerabilities).length, 19);
  const findings = requireOriginalClassification(audit);
  assert.equal(findings.length, 19);
  assert.equal(findings.some((finding) => finding.exposure === "unknown"), false);
  for (const finding of findings) {
    for (const id of finding.advisories) assert.equal(advisoryUrl(id), `https://github.com/advisories/${id}`);
  }
  const extra = structuredClone(audit);
  extra.vulnerabilities["not-reviewed"] = { severity: "low", via: [] };
  assert.throws(() => requireOriginalClassification(extra), /unclassified audit packages/);
});

test("reviewed lockfile keeps the patched closure and the payment pins", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.version, REVIEWED_SOURCE.version);
  assert.equal(manifest.version, "1.23.55");
  assertReviewedClosure(lock);
  const broken = structuredClone(lock);
  const body = broken.packages["node_modules/body-parser"];
  assert.equal(body.version, "1.20.9");
  body.version = "1.20.6";
  assert.throws(() => assertReviewedClosure(broken), /body-parser node_modules\/body-parser 1\.20\.6/);
});

test("current npm audit stays inside the reviewed remainder", { timeout: 120_000 }, () => {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(report.vulnerabilities).sort(), [...REVIEWED_REMAINDER]);
  assert.equal(report.metadata.vulnerabilities.critical, 0);
  assert.equal(report.metadata.vulnerabilities.moderate, 2);
  assert.equal(report.metadata.vulnerabilities.high, 11);
  assert.equal(report.metadata.vulnerabilities.total, 13);
  for (const name of ["proxy-addr", "body-parser", "qs", "express", "fast-uri", "@modelcontextprotocol/sdk"]) {
    assert.equal(report.vulnerabilities[name], undefined, name);
  }
});

test("proxy-addr 2.0.8 does not trust every IPv4 from a short mapped prefix", async () => {
  const spoofed = { headers: { "x-forwarded-for": "9.9.9.9" } };
  const mapped = proxyaddr({
    ...spoofed,
    socket: { remoteAddress: "1.2.3.4" },
  }, proxyaddr.compile("::ffff:10.0.0.0/8"));
  assert.equal(mapped, "1.2.3.4");
  const inside = proxyaddr({
    socket: { remoteAddress: "10.1.2.3" },
    headers: { "x-forwarded-for": "8.8.8.8" },
  }, proxyaddr.compile("::ffff:10.0.0.0/104"));
  assert.equal(inside, "8.8.8.8");
  const outside = proxyaddr({
    socket: { remoteAddress: "1.2.3.4" },
    headers: { "x-forwarded-for": "9.9.9.9" },
  }, proxyaddr.compile("::ffff:10.0.0.0/104"));
  assert.equal(outside, "1.2.3.4");

  const app = express();
  app.set("trust proxy", 1);
  app.get("/", (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const server = await listen(app);
  try {
    const response = await request({
      port: server.port,
      headers: { "x-forwarded-for": "9.9.9.9, 8.8.8.8" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ip: "8.8.8.8", ips: ["8.8.8.8"] });
  } finally {
    await server.close();
  }
});

test("body-parser answers a gzip body with one trailing byte and stays up", async () => {
  const crashes = [];
  const onCrash = (error) => crashes.push(error);
  process.on("uncaughtException", onCrash);
  const app = express();
  app.use(express.json());
  app.post("/", (req, res) => res.json({ ok: true, a: req.body?.a }));
  const server = await listen(app);
  try {
    const gzip = zlib.gzipSync(Buffer.from(JSON.stringify({ ok: true, a: 1 })));
    const response = await request({
      port: server.port,
      method: "POST",
      path: "/",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(gzip.length + 1),
      },
      body: Buffer.concat([gzip, Buffer.from([0])]),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true, a: 1 });
    assert.deepEqual(crashes, []);
  } finally {
    process.off("uncaughtException", onCrash);
    await server.close();
  }
});

test("qs 6.16.2 keeps comma stringify and ordinary parse", () => {
  const stringified = qs.stringify({ a: [{ toString: "x" }] }, { arrayFormat: "comma" });
  assert.equal(stringified, "a=%5Bobject%20Object%5D");
  assert.deepEqual(qs.parse("a=1&b=2"), { a: "1", b: "2" });
});

test("fast-uri 3.1.9 leaves a percent-encoded scheme inert and still folds host case", () => {
  const uri = fastUri.normalize ? fastUri : fastUri.default;
  assert.equal(uri.normalize("%6Aavascript:alert(1)"), "%6Aavascript:alert(1)");
  assert.equal(uri.parse("%6Aavascript:alert(1)").scheme, "%6Aavascript");
  assert.equal(uri.equal("//%41.com", "//a.com"), true);
  assert.equal(uri.parse("//%41.com").host, "a.com");
});

test("streamable HTTP refuses a pre-parsed batch over 100 and still accepts initialize", async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post("/mcp", async (req, res) => {
    const server = new McpServer({ name: "dependency-risk", version: "0" }, MCP_SERVER_INPUT_LIMITS);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const server = await listen(app);
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  try {
    const batch = Array.from({ length: 101 }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "ping",
    }));
    const refused = await request({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers,
      body: JSON.stringify(batch),
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body, /Batch must not exceed 100 messages/);

    const allowed = await request({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers,
      body: JSON.stringify(batch.slice(0, 2)),
    });
    assert.equal(allowed.status, 200);
    assert.doesNotMatch(allowed.body, /Batch must not exceed 100 messages/);

    const initialized = await request({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "dependency-risk", version: "0" },
        },
      }),
    });
    assert.equal(initialized.status, 200);
    assert.match(initialized.body, /2025-03-26/);
    assert.match(initialized.body, /dependency-risk/);
  } finally {
    await server.close();
  }
});

test("tool input ceiling admits the lockfile budget and refuses one element past it", async () => {
  assert.equal(MCP_TOOL_INPUT_ELEMENT_CEILING, LOCKFILE_PIN_DELTA_MAX_JSON_NODES * 2 + 1024);
  assert.equal(MCP_SERVER_INPUT_LIMITS.maxToolInputElements, MCP_TOOL_INPUT_ELEMENT_CEILING);
  let calls = 0;
  const server = new McpServer({ name: "ceiling", version: "0" }, MCP_SERVER_INPUT_LIMITS);
  server.registerTool("count", {
    inputSchema: { items: z.array(z.any()) },
  }, async ({ items }) => {
    calls += 1;
    return { content: [{ type: "text", text: String(items.length) }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "ceiling", version: "0" });
  await client.connect(clientTransport);
  try {
    const accepted = await client.callTool({
      name: "count",
      arguments: { items: Array.from({ length: LOCKFILE_PIN_DELTA_MAX_JSON_NODES * 2 }, () => 1) },
    });
    assert.equal(calls, 1);
    assert.equal(accepted.isError, undefined);
    assert.match(JSON.stringify(accepted.content), /100000/);

    const refused = await client.callTool({
      name: "count",
      arguments: { items: Array.from({ length: MCP_TOOL_INPUT_ELEMENT_CEILING + 1 }, () => 1) },
    });
    assert.equal(calls, 1);
    assert.equal(refused.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("production MCP constructors receive the same ceiling", async () => {
  for (const relative of ["mcp-server.mjs", "page-change-mcp.mjs", "page-change-mcp-stdio-probe.mjs"]) {
    assert.match(read(relative), /MCP_SERVER_INPUT_LIMITS/);
  }
  assert.match(read("mcp-server.mjs"), /new McpServer\(serverInfo, MCP_SERVER_INPUT_LIMITS\)/);
  assert.match(read("mcp-server.mjs"), /new sdk\.McpServer\(serverInfo, MCP_SERVER_INPUT_LIMITS\)/);
  const page = new McpServer({ name: "page-change", version: "1.23.55" }, {
    instructions: "compare",
    ...MCP_SERVER_INPUT_LIMITS,
  });
  assert.equal(typeof page.registerTool, "function");
  const { McpServer: ModernServer } = await import("@modelcontextprotocol/server");
  const modern = new ModernServer({ name: "modern", version: "0" }, MCP_SERVER_INPUT_LIMITS);
  assert.equal(typeof modern.registerTool, "function");
});

test("payment packages still refuse an empty charge without a live call", async () => {
  const stack = createMppDualStack({
    publicUrl: "https://merchant.example",
    network: "eip155:8453",
    payTo: "0x0000000000000000000000000000000000000000",
    routes: [],
  });
  assert.equal(stack.enabled, false);
  assert.match(stack.reason, /MPP_SECRET_KEY/);
  assert.deepEqual(await stack.authorize({}), { kind: "disabled" });
  assert.equal(PaymentRequiredV2Schema.safeParse({}).success, false);
  assert.equal(typeof ExactEvmScheme, "function");
  const config = createFacilitatorConfig();
  assert.equal(config.url, "https://api.cdp.coinbase.com/platform/v2/x402");
  assert.equal(typeof config.createAuthHeaders, "function");
});

test("@coinbase/x402 postinstall remains the reviewed notice", () => {
  assert.equal(assertPostinstallNotice(root), COINBASE_X402_POSTINSTALL_SHA256);
});

test("production source does not call the inapplicable advisory packages", () => {
  const graph = assertInapplicableImportsStayUncalled(merchantProductionImports(root));
  assert.ok(graph.files.includes("server.js"));
  assert.ok(graph.files.includes("page-change-mcp.mjs"));
  assert.ok(graph.files.includes("mcp-server.mjs"));
  assert.ok(graph.files.includes("aiax-discovery/projection.mjs"));
  // Each remaining import() builds a local file URL or loads a relative experiment
  // module. None of them names axios, follow-redirects, hono, ip-address, or
  // express-rate-limit.
  assert.deepEqual(graph.dynamicNonLiteral, [
    "examples/customer-x402/src/page-change/provenance.mjs",
    "experiments/scoped-surface-delivery-100312/src/regression.mjs",
    "experiments/scoped-surface-delivery-100312/src/scan-child.mjs",
    "experiments/seller-repair-service-100266/src/journey.mjs",
    "public-acquisition/optional-mount.mjs",
    "server.js",
  ]);
  const listener = read("node_modules/@hono/node-server/dist/index.mjs");
  assert.doesNotMatch(listener, /parseBody|toSSG|serveStatic/);
  const transport = read("node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js");
  assert.match(transport, /getRequestListener/);
  assert.match(transport, /@hono\/node-server/);
  assert.doesNotMatch(transport, /parseBody|serve-static|toSSG/);
  assert.equal(FINDINGS.find((finding) => finding.package === "hono").exposure, "inapplicable");
  assert.equal(FINDINGS.find((finding) => finding.package === "follow-redirects").disposition, "no-patch");
  assert.equal(FINDINGS.find((finding) => finding.package === "zod").disposition, "partial");
});
