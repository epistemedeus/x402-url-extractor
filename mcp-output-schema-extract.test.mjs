import assert from "node:assert/strict";
import test from "node:test";

import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolResult, mountMcp } from "./mcp-server.mjs";
import { extract, extractMcpOutputSchema, readMarkdown, readMcpOutputSchema } from "./extract.mjs";
import {
  agentSurfaceBudgetAuditMcpOutputSchema,
} from "./agent-surface-budget-audit.mjs";
import { contractQualifiedSearchMcpOutputSchema } from "./contract-qualified-search.mjs";
import { morphoPreLiquidationReplayMcpOutputSchema } from "./morpho-preliquidation-replay.mjs";
import { morphoProtectionMcpOutputSchema } from "./morpho-protection.mjs";
import { opportunityPreflightMcpOutputSchema } from "./opportunity-preflight.mjs";
import { paymentOfferPreflightMcpOutputSchema } from "./payment-offer-preflight.mjs";
import { scanRepoMcpOutputSchema } from "./scan.mjs";
import { settlementProofMcpOutputSchema } from "./settlement-proof.mjs";
import { statefulWalletPolicyConformanceMcpOutputSchema } from "./stateful-wallet-policy-conformance.mjs";
import { walletPolicyConformanceMcpOutputSchema } from "./wallet-policy-conformance.mjs";

const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express");

const NETWORK = "eip155:84532";
const PAY_TO = "0x2000000000000000000000000000000000000002";
const PAYER = "0x1000000000000000000000000000000000000001";
const MCP_HEADERS = Object.freeze({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

const PRIOR_TYPED_MCP = Object.freeze([
  ["scan", scanRepoMcpOutputSchema],
  ["morpho_protection", morphoProtectionMcpOutputSchema],
  ["morpho_preliquidation_replay", morphoPreLiquidationReplayMcpOutputSchema],
  ["opportunity_preflight", opportunityPreflightMcpOutputSchema],
  ["payment_offer_preflight", paymentOfferPreflightMcpOutputSchema],
  ["contract_qualified_search", contractQualifiedSearchMcpOutputSchema],
  ["agent_surface_budget_audit", agentSurfaceBudgetAuditMcpOutputSchema],
  ["settlement_proof", settlementProofMcpOutputSchema],
  ["wallet_policy_conformance", walletPolicyConformanceMcpOutputSchema],
  ["stateful_wallet_policy_conformance", statefulWalletPolicyConformanceMcpOutputSchema],
]);

function schemaType(schema) {
  return schema?._def?.typeName;
}

function isOptional(schema) {
  return schemaType(schema) === "ZodOptional" || schemaType(schema) === "ZodDefault";
}

function requiredPathsFromSchema(schema, prefix = "") {
  const type = schemaType(schema);
  if (type === "ZodOptional" || type === "ZodDefault") return [];
  if (type === "ZodNullable" || type === "ZodEffects") {
    return requiredPathsFromSchema(type === "ZodEffects" ? schema._def.schema : schema._def.innerType, prefix);
  }
  if (type === "ZodObject") {
    const paths = [];
    for (const [key, child] of Object.entries(schema.shape)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isOptional(child)) continue;
      paths.push(path);
      paths.push(...requiredPathsFromSchema(child, path));
    }
    return paths;
  }
  if (type === "ZodUnion" || type === "ZodDiscriminatedUnion") {
    const sets = (schema._def.options || []).map((option) => new Set(requiredPathsFromSchema(option, prefix)));
    if (!sets.length) return [];
    return [...sets[0]].filter((path) => sets.every((set) => set.has(path)));
  }
  return [];
}

function assertRequiredPaths(schema, value, path = "$") {
  const type = schemaType(schema);
  if (type === "ZodOptional") {
    if (value === undefined) return;
    return assertRequiredPaths(schema._def.innerType, value, path);
  }
  if (type === "ZodNullable") {
    if (value === null) return;
    return assertRequiredPaths(schema._def.innerType, value, path);
  }
  if (type === "ZodDefault") return assertRequiredPaths(schema._def.innerType, value, path);
  if (type === "ZodEffects") return assertRequiredPaths(schema._def.schema, value, path);
  if (type === "ZodObject") {
    assert.equal(Boolean(value) && typeof value === "object" && !Array.isArray(value), true, `${path} must be an object`);
    for (const [key, child] of Object.entries(schema.shape)) {
      const childPath = `${path}.${key}`;
      if (isOptional(child)) {
        if (Object.hasOwn(value, key) && value[key] !== undefined) assertRequiredPaths(child, value[key], childPath);
        continue;
      }
      assert.equal(Object.hasOwn(value, key), true, `missing required path ${childPath}`);
      assertRequiredPaths(child, value[key], childPath);
    }
    return;
  }
  if (type === "ZodArray") {
    assert.equal(Array.isArray(value), true, `${path} must be an array`);
    for (const [index, item] of value.entries()) {
      assertRequiredPaths(schema._def.type, item, `${path}[${index}]`);
    }
    return;
  }
  if (type === "ZodUnion" || type === "ZodDiscriminatedUnion") {
    const match = (schema._def.options || []).find((option) => option.safeParse(value).success);
    assert.ok(match, `${path} did not match a declared union option`);
    return assertRequiredPaths(match, value, path);
  }
}

function assertSchemaMatchesHandler(schema, value) {
  const parsed = schema.safeParse(value);
  assert.equal(parsed.success, true, parsed.success ? "" : parsed.error);
  const roundTrip = JSON.parse(JSON.stringify(value));
  const roundTripParsed = schema.safeParse(roundTrip);
  assert.equal(roundTripParsed.success, true, roundTripParsed.success ? "" : roundTripParsed.error);
  assertRequiredPaths(schema, value);
  for (const path of requiredPathsFromSchema(schema)) {
    const parts = path.split(".");
    let current = value;
    for (const part of parts) {
      if (current === null) break;
      assert.equal(Boolean(current) && typeof current === "object" && !Array.isArray(current) && Object.hasOwn(current, part), true, `missing required path ${path}`);
      current = current[part];
    }
  }
  assert.equal(schema.safeParse({ ...value, extra: true }).success, false);
  const [firstRequired] = requiredPathsFromSchema(schema);
  if (firstRequired && !firstRequired.includes(".")) {
    const { [firstRequired]: _removed, ...rest } = value;
    assert.equal(schema.safeParse(rest).success, false);
  }
}

function payment(accepted) {
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  };
}

function createFacilitator() {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
    },
    async verify() {
      return { isValid: true, payer: PAYER };
    },
    async settle() {
      return { success: true, transaction: `0x${"33".repeat(32)}`, network: NETWORK };
    },
  };
}

function decodeMcpBody(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    const payload = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("");
    return payload ? JSON.parse(payload) : null;
  }
  return JSON.parse(text);
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

const SPARSE_HTML = `<!doctype html><html lang="en"><head><title>Example Domain</title></head><body><h1>Example Domain</h1><p>docs</p><a href="https://iana.org/domains/example">Learn more</a></body></html>`;
const RICH_HTML = `<!doctype html><html lang="en"><head>
<title>Rich Page</title>
<meta name="description" content="Rich description">
<meta property="og:title" content="OG Title">
<meta property="og:description" content="OG Description">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="https://rich.example/page">
<script type="application/ld+json">{"@type":["Product","Thing"],"name":"Widget"}</script>
</head><body><h1>Rich Heading</h1><h2>Sub</h2><a href="/about">About</a><p>Readable body text for excerpt.</p></body></html>`;

function htmlResponse(html, { status = 200, url = "https://fixture.example/", contentType = "text/html; charset=utf-8" } = {}) {
  const encoder = new TextEncoder();
  const body = encoder.encode(html);
  return {
    status,
    url,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null) },
    body: {
      getReader() {
        let done = false;
        return {
          async read() {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: body };
          },
        };
      },
    },
  };
}

function installExtractFetch(fixtures) {
  const original = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (input, init) => {
    const target = String(typeof input === "string" || input instanceof URL ? input : input.url);
    if (target.startsWith("http://127.0.0.1")) return original(input, init);
    const hit = fixtures[target] || fixtures["*"];
    if (!hit) throw new Error(`unexpected fetch ${target}`);
    return typeof hit === "function" ? hit(target, init) : hit;
  };
  return () => {
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = original;
  };
}

async function startMountedExtract(options = {}) {
  const app = express();
  const tools = options.tools || [{
    name: "extract",
    description: "extract fixture",
    price: "$0.005",
    inputSchema: { url: z.string() },
    outputSchema: extractMcpOutputSchema,
    run: (args) => extract(args.url),
    tags: ["web", "extract"],
  }];
  await mountMcp(app, {
    facilitatorClient: createFacilitator(),
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "extract-output-schema", version: "test" },
    tools,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    async post(body) {
      const response = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        json: decodeMcpBody(buffer, response.headers.get("content-type")),
      };
    },
    async close() {
      await closeServer(server);
    },
  };
}

async function unpaidAccepts(mounted, url = "https://fixture.example/") {
  const unpaid = await mounted.post({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "extract", arguments: { url } },
  });
  const body = unpaid.json?.result?.structuredContent
    || (unpaid.json?.result?.content?.[0]?.text ? JSON.parse(unpaid.json.result.content[0].text) : null);
  const accepts = body?.accepts?.[0];
  assert.ok(accepts, "unpaid extract did not return issued accepts");
  assert.equal(unpaid.json?.result?.isError, true);
  return { unpaid, accepts, body };
}

async function paidExtract(mounted, accepts, url, id = 2) {
  return mounted.post({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "extract",
      arguments: { url },
      _meta: { "x402/payment": payment(accepts) },
    },
  });
}

test("prior ten typed MCP schemas remain exported and strict", () => {
  assert.equal(PRIOR_TYPED_MCP.length, 10);
  for (const [name, schema] of PRIOR_TYPED_MCP) {
    assert.equal(schemaType(schema), "ZodObject", `${name} drifted from object schema`);
    assert.equal(schema.safeParse({ extra: true }).success, false, `${name} lost strictness`);
    assert.ok(requiredPathsFromSchema(schema).length > 0, `${name} has no required paths`);
  }
});

test("extract handler success variants cover every MCP schema-required path", async () => {
  const restore = installExtractFetch({
    "https://sparse.example/": htmlResponse(SPARSE_HTML, { url: "https://sparse.example/" }),
    "https://rich.example/page": htmlResponse(RICH_HTML, { url: "https://rich.example/page" }),
  });
  try {
    const sparse = await extract("https://sparse.example/");
    assertSchemaMatchesHandler(extractMcpOutputSchema, sparse);
    assert.equal(sparse.description, null);
    assert.equal(sparse.canonical, null);
    assert.deepEqual(sparse.openGraph, {});
    assert.deepEqual(sparse.twitter, {});
    assert.deepEqual(sparse.jsonLd, []);
    assert.equal(sparse.aiReadiness.hasJsonLd, false);

    const rich = await extract("https://rich.example/page");
    assertSchemaMatchesHandler(extractMcpOutputSchema, rich);
    assert.equal(rich.description, "Rich description");
    assert.equal(rich.canonical, "https://rich.example/page");
    assert.equal(rich.openGraph["og:title"], "OG Title");
    assert.equal(rich.twitter["twitter:card"], "summary");
    assert.equal(rich.jsonLd.length, 1);
    assert.equal(rich.aiReadiness.hasJsonLd, true);
    assert.ok(rich.aiReadiness.schemaTypes.length >= 1);
  } finally {
    restore();
  }
});

test("mounted MCP lists extract outputSchema and serves typed structuredContent on paid success", async () => {
  const restore = installExtractFetch({
    "https://sparse.example/": htmlResponse(SPARSE_HTML, { url: "https://sparse.example/" }),
    "https://rich.example/page": htmlResponse(RICH_HTML, { url: "https://rich.example/page" }),
    "https://empty.example/": htmlResponse("", { contentType: null, url: "" }),
    "https://upstream-error.example/": htmlResponse("<p>Not found</p>", { status: 404 }),
    "https://graph.example/": htmlResponse(`<script type="application/ld+json">{"@graph":[{"@type":["Thing","Product"]},{"@type":{"unusual":true}}]}</script><script type="application/ld+json">42</script>`),
  });
  const mounted = await startMountedExtract();
  try {
    const initialized = await mounted.post({
      jsonrpc: "2.0", id: 9, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {},
        clientInfo: { name: "extract-contract-review", version: "1.0.0" } },
    });
    assert.equal(initialized.json.result.serverInfo.name, "extract-output-schema");
    const listed = await mounted.post({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
      params: {},
    });
    const advertised = listed.json?.result?.tools?.find((tool) => tool.name === "extract");
    assert.ok(advertised);
    assert.equal(advertised.outputSchema?.type, "object");
    assert.equal(advertised.outputSchema.additionalProperties, false);
    for (const path of requiredPathsFromSchema(extractMcpOutputSchema).filter((item) => !item.includes("."))) {
      assert.equal(advertised.outputSchema.required.includes(path), true, `tools/list omitted required ${path}`);
    }
    assert.equal(advertised.inputSchema?.required?.includes("url"), true);
    assert.ok(advertised._meta?.x402?.paymentRequired);

    for (const [id, url] of [[11, "https://sparse.example/"], [12, "https://rich.example/page"],
      [13, "https://empty.example/"], [14, "https://upstream-error.example/"], [15, "https://graph.example/"]]) {
      const { accepts } = await unpaidAccepts(mounted, url);
      const paid = await paidExtract(mounted, accepts, url, id);
      assert.equal(Boolean(paid.json?.result?.isError), false, JSON.stringify(paid.json));
      const structured = paid.json.result.structuredContent;
      assert.ok(structured);
      assertSchemaMatchesHandler(extractMcpOutputSchema, structured);
      const text = JSON.parse(paid.json.result.content[0].text);
      assert.deepEqual(text, structured);
      if (url.includes("empty")) {
        assert.equal(structured.title, "");
        assert.equal(structured.url, url);
        assert.equal(structured.requestedUrl, url);
        assert.equal(structured.finalUrl, url);
        assert.equal(structured.sourceOk, true);
        assert.equal(structured.error, null);
        for (const field of ["contentType", "description", "canonical", "lang"]) assert.equal(structured[field], null);
      }
      if (url.includes("upstream-error")) {
        assert.equal(structured.status, 404);
        assert.equal(structured.sourceOk, false);
        assert.equal(structured.error?.code, "http_404");
        assert.match(structured.text, /Not found/i);
        assert.equal(structured.ok, true);
      }
      if (url.includes("graph")) {
        assert.deepEqual(structured.aiReadiness.schemaTypes, [["Thing", "Product"], { unusual: true }]);
        assert.equal(structured.jsonLd[1], 42);
      }
    }
  } finally {
    await mounted.close();
    restore();
  }
});

test("unpaid extract stays a payment challenge, not a typed success body", async () => {
  const mounted = await startMountedExtract();
  try {
    const { unpaid, body } = await unpaidAccepts(mounted, "https://fixture.example/");
    assert.equal(unpaid.status, 200);
    assert.equal(unpaid.json.result.isError, true);
    assert.equal(Number.isInteger(body.x402Version), true);
    assert.equal(Array.isArray(body.accepts), true);
    assert.equal(extractMcpOutputSchema.safeParse(body).success, false);
    assert.equal(extractMcpOutputSchema.safeParse(unpaid.json.result.structuredContent).success, false);
  } finally {
    await mounted.close();
  }
});

test("application errors and malformed success stay untyped", async () => {
  const restore = installExtractFetch({
    "https://ok.example/": htmlResponse(SPARSE_HTML, { url: "https://ok.example/" }),
  });
  const mounted = await startMountedExtract({
    tools: [
      {
        name: "extract",
        description: "extract fixture",
        price: "$0.005",
        inputSchema: { url: z.string() },
        outputSchema: extractMcpOutputSchema,
        run: async (args) => {
          if (args.url.includes("malformed")) return { ok: true, url: args.url };
          if (args.url.includes("missing-nullable") || args.url.includes("wrong-type")) {
            const result = await extract("https://ok.example/");
            if (args.url.includes("missing-nullable")) delete result.contentType;
            else result.title = null;
            return result;
          }
          return extract(args.url);
        },
        tags: ["web", "extract"],
      },
    ],
  });
  try {
    const { accepts: appAccepts } = await unpaidAccepts(mounted, "https://127.0.0.1/");
    const appErr = await paidExtract(mounted, appAccepts, "https://127.0.0.1/", 21);
    assert.equal(appErr.json.result.isError, true);
    assert.equal("structuredContent" in (appErr.json.result || {}), false);
    const appBody = JSON.parse(appErr.json.result.content[0].text);
    assert.equal(appBody.ok, false);
    assert.equal(extractMcpOutputSchema.safeParse(appBody).success, false);

    for (const [index, kind] of ["malformed", "missing-nullable", "wrong-type"].entries()) {
      const url = `https://${kind}.example/`;
      const { accepts: badAccepts } = await unpaidAccepts(mounted, url);
      const malformed = await paidExtract(mounted, badAccepts, url, 22 + index);
      assert.equal(malformed.json.result.isError, true);
      assert.equal("structuredContent" in (malformed.json.result || {}), false);
      assert.match(malformed.json.result.content[0].text, /Output validation error|Invalid structured content|Required/);
    }
  } finally {
    await mounted.close();
    restore();
  }
});

test("InMemory transport projects extract structuredContent only with outputSchema", async () => {
  const sparse = {
    ok: true,
    requestedUrl: "https://sparse.example/",
    finalUrl: "https://sparse.example/",
    url: "https://sparse.example/",
    status: 200,
    sourceOk: true,
    error: null,
    contentType: "text/html",
    title: "Example Domain",
    description: null,
    canonical: null,
    lang: "en",
    openGraph: {},
    twitter: {},
    jsonLd: [],
    headings: { h1: ["Example Domain"], h2: [] },
    links: ["https://iana.org/domains/example"],
    text: "Example Domain docs Learn more",
    aiReadiness: {
      hasJsonLd: false,
      hasOpenGraph: false,
      hasTitle: true,
      hasDescription: false,
      hasCanonical: false,
      schemaTypes: [],
    },
    capture: {
      method: "http-get-no-javascript",
      javascriptExecuted: false,
      maxBodyBytes: 3_000_000,
      textExcerptLimitChars: 1200,
      markdownLimitChars: null,
      bodyBytes: 128,
      bodyTruncated: false,
      textTruncated: false,
      charset: "utf-8",
      charsetSource: "content-type",
    },
    fetchedAt: "2026-09-07T21:00:00.000Z",
  };
  assertSchemaMatchesHandler(extractMcpOutputSchema, sparse);

  const server = new McpServer({ name: "extract-schema-memory", version: "test" });
  server.registerTool("extract", {
    description: "extract",
    inputSchema: { url: z.string() },
    outputSchema: extractMcpOutputSchema,
  }, async () => asToolResult(sparse, { structured: true }));
  server.registerTool("throwing_extract", {
    description: "throwing",
    inputSchema: { url: z.string() },
  }, async () => ({ ...asToolResult({ ok: false, error: "private/loopback host blocked" }), isError: true }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "extract-schema-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const listed = await client.listTools();
  const advertised = listed.tools.find((tool) => tool.name === "extract");
  assert.equal(advertised.outputSchema?.type, "object");
  assert.equal(advertised.outputSchema.additionalProperties, false);

  const ok = await client.callTool({ name: "extract", arguments: { url: "https://sparse.example/" } });
  assert.equal(Boolean(ok.isError), false);
  assert.deepEqual(ok.structuredContent, sparse);

  const failed = await client.callTool({ name: "throwing_extract", arguments: { url: "https://127.0.0.1/" } });
  assert.equal(failed.isError, true);
  assert.equal("structuredContent" in failed, false);

  assert.equal("structuredContent" in asToolResult(sparse), false);
  assert.deepEqual(asToolResult(sparse, { structured: true }).structuredContent, sparse);

  await client.close();
  await server.close();
});



test("mounted read exports its actual schema and typed source refusal without granting useful-content status", async () => {
  const restore = installExtractFetch({ "https://denied.example/": htmlResponse("<p>Access denied</p>", { status: 403, url: "https://denied.example/" }) });
  const mounted = await startMountedExtract({ tools: [{ name: "read", description: "local read fixture", price: "$0.005", inputSchema: { url: z.string() }, outputSchema: readMcpOutputSchema, run: args => readMarkdown(args.url) }] });
  try {
    const listed = await mounted.post({ jsonrpc: "2.0", id: 50, method: "tools/list", params: {} });
    const schema = listed.json.result.tools.find(t => t.name === "read").outputSchema;
    assert.ok(schema.required.includes("markdown"));
    assert.ok(schema.required.includes("sourceOk"));
    const call = { jsonrpc: "2.0", id: 51, method: "tools/call", params: { name: "read", arguments: { url: "https://denied.example/" } } };
    const unpaid = await mounted.post(call);
    const raw = unpaid.json.result;
    const challenge = raw.structuredContent || JSON.parse(raw.content[0].text);
    assert.equal(raw.isError, true);
    const paid = await mounted.post({ ...call, id: 52, params: { ...call.params, _meta: { "x402/payment": payment(challenge.accepts[0]) } } });
    const output = paid.json.result.structuredContent;
    assert.equal(readMcpOutputSchema.safeParse(output).success, true);
    assert.equal(output.sourceOk, false); assert.equal(output.status, 403);
    assert.equal(output.error.code, "http_403");
  } finally { await mounted.close(); restore(); }
});
