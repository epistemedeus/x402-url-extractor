import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Challenge } from "mppx";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { z } from "zod";

import { asToolResult } from "./mcp-server.mjs";
import {
  PaymentOfferPreflightError,
  paymentOfferPreflight,
  paymentOfferPreflightMcpOutputSchema,
} from "./payment-offer-preflight.mjs";
import {
  contractQualifiedSearch,
  contractQualifiedSearchMcpOutputSchema,
  normalizeContractQualifiedSearchInput,
} from "./contract-qualified-search.mjs";
import {
  BASE_USDC,
  settlementProof,
  settlementProofMcpOutputSchema,
} from "./settlement-proof.mjs";

function schemaType(schema) {
  return schema?._def?.typeName;
}

function isOptional(schema) {
  return schemaType(schema) === "ZodOptional" || schemaType(schema) === "ZodDefault";
}

function requiredPathsFromSchema(schema, prefix = "") {
  const type = schemaType(schema);
  if (type === "ZodOptional" || type === "ZodDefault") {
    return [];
  }
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

function advertisedObjectSchemas(outputSchema) {
  assert.equal(outputSchema?.type, "object", "tools/list outputSchema must be a JSON object");
  return [outputSchema];
}

const PREFLIGHT_TARGET = "https://api.example.com/paid?a=1&b=2";
const PREFLIGHT_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PREFLIGHT_RECIPIENT = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const PREFLIGHT_NOW = Date.parse("2026-08-10T20:00:00.000Z");

function x402Header({ amount = "5000", resource = PREFLIGHT_TARGET } = {}) {
  return Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: resource, description: "Paid test resource", mimeType: "application/json" },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: PREFLIGHT_ASSET,
      amount,
      payTo: PREFLIGHT_RECIPIENT,
      maxTimeoutSeconds: 300,
    }],
  })).toString("base64");
}

function mppHeader({ amount = "5000", realm = "api.example.com", expires = "2026-08-10T20:05:00.000Z" } = {}) {
  return Challenge.serialize(Challenge.from({
    id: "test-payment-challenge",
    realm,
    method: "evm",
    intent: "charge",
    expires,
    request: {
      amount,
      currency: PREFLIGHT_ASSET,
      recipient: PREFLIGHT_RECIPIENT,
      methodDetails: { chainId: 8453, credentialTypes: ["authorization"], decimals: 6 },
    },
  }));
}

function preflightResponse({ status = 402, paymentRequired, authenticate, finalUrl = PREFLIGHT_TARGET } = {}) {
  const headers = new Headers();
  if (paymentRequired) headers.set("payment-required", paymentRequired);
  if (authenticate) headers.set("www-authenticate", authenticate);
  return { status, headers, finalUrl };
}

function openapiDocument() {
  return {
    paths: {
      "/paid": {
        get: {
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["risk", "evidence"],
                    properties: { risk: { type: "number" }, evidence: { type: "array", items: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

async function runPreflight(overrides = {}) {
  return paymentOfferPreflight({ url: PREFLIGHT_TARGET, ...overrides.input }, {
    now: PREFLIGHT_NOW,
    openapiImpl: async () => openapiDocument(),
    requestImpl: async () => preflightResponse({
      paymentRequired: x402Header(),
      authenticate: mppHeader(),
    }),
    ...overrides,
  });
}

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SETTLEMENT_TX = `0x${"1".repeat(64)}`;
const SETTLEMENT_PAYER = "0x1111111111111111111111111111111111111111";
const SETTLEMENT_RECIPIENT = "0x2222222222222222222222222222222222222222";
const SETTLEMENT_OTHER = "0x3333333333333333333333333333333333333333";
const SETTLEMENT_INPUT = {
  transactionHash: SETTLEMENT_TX,
  recipient: SETTLEMENT_RECIPIENT,
  amountAtomic: "5000",
  payer: SETTLEMENT_PAYER,
};

function transfer(from = SETTLEMENT_PAYER, to = SETTLEMENT_RECIPIENT, value = 5_000n) {
  return {
    address: BASE_USDC,
    topics: encodeEventTopics({ abi: [TRANSFER_EVENT], eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

function settlementClient({ logs = [transfer()], status = "success", receiptError = false, blockError = false } = {}) {
  return {
    async getTransactionReceipt() {
      if (receiptError) throw new Error("missing");
      return { status, blockNumber: 49_823_378n, logs };
    },
    async getBlock() {
      if (blockError) throw new Error("missing");
      return { timestamp: 1_786_350_903n };
    },
  };
}

async function runSettlement(clientOptions) {
  return settlementProof(SETTLEMENT_INPUT, {
    client: settlementClient(clientOptions),
    now: () => new Date("2026-08-11T08:30:00.000Z"),
  });
}

const SEARCH_REQUEST = {
  query: "service domain ownership code provenance",
  requiredPaths: ["data.sourceRepository"],
  limit: 3,
};

function jsonResponse(value) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(value) };
}

const AGENT402_PAYLOAD = { results: [
  { seller: "https://good.example", sellerName: "Good", url: "https://good.example/provenance", route: "/provenance", method: "GET", priceUsd: 0.01, payable: "x402", description: "source repository provenance", score: 20 },
  { seller: "https://unsafe.example", url: "https://unsafe.example/domain/{name}", route: "/domain/{name}", method: "GET", priceUsd: 0.005, payable: "x402", description: "domain provenance", score: 19 },
] };

const MPP_PAYLOAD = { services: [{
  status: "active", name: "Source proof", serviceUrl: "https://mpp.example", description: "service source provenance", tags: ["source", "repository"], docs: { apiReference: "https://mpp.example/spec.json" },
  endpoints: [{ method: "GET", path: "/proof", description: "source repository proof", payment: { amount: "5000", decimals: 6, currency: "USD" } }],
}] };

async function runSearch({ auditImpl, agent402 = AGENT402_PAYLOAD, mpp = MPP_PAYLOAD, request = SEARCH_REQUEST } = {}) {
  return contractQualifiedSearch(request, {
    fetchImpl: async (url) => jsonResponse(String(url).includes("agent402") ? agent402 : mpp),
    auditImpl: auditImpl || (async () => ({
      ok: true,
      machineBuyable: true,
      routes: [{
        protocols: ["x402"],
        runtimeChallengeVerified: true,
        findings: [],
        responseContract: { decision: "admissible", guaranteedPaths: ["data.sourceRepository"] },
      }],
    })),
    now: () => new Date("2026-08-12T12:00:00.000Z"),
  });
}

test("payment_offer_preflight handler output covers every MCP schema-required path", async () => {
  const parseable = await runPreflight();
  assertSchemaMatchesHandler(paymentOfferPreflightMcpOutputSchema, parseable);
  assert.equal(parseable.decision, "parseable_offer");
  assert.equal(parseable.offers.find((offer) => offer.protocol === "x402").valid, true);
  assert.equal(parseable.offers.find((offer) => offer.protocol === "mpp").valid, true);

  const catalog = await runPreflight({
    input: {
      catalog: {
        source: "coinbase-bazaar",
        protocol: "x402",
        method: "GET",
        url: PREFLIGHT_TARGET,
        amountAtomic: "5000",
        network: "eip155:8453",
        asset: PREFLIGHT_ASSET,
        recipient: PREFLIGHT_RECIPIENT,
      },
    },
    requestImpl: async () => preflightResponse({ paymentRequired: x402Header() }),
  });
  assertSchemaMatchesHandler(paymentOfferPreflightMcpOutputSchema, catalog);
  assert.equal(catalog.catalogCoherence[0].decision, "partial");

  const review = await runPreflight({
    openapiImpl: async () => ({ paths: { "/paid": { get: { responses: { 200: { description: "undocumented body" } } } } } }),
    requestImpl: async () => preflightResponse({ paymentRequired: x402Header() }),
  });
  assertSchemaMatchesHandler(paymentOfferPreflightMcpOutputSchema, review);
  assert.equal(review.decision, "review_required");

  const none = await runPreflight({
    requestImpl: async () => preflightResponse({ status: 200 }),
  });
  assertSchemaMatchesHandler(paymentOfferPreflightMcpOutputSchema, none);
  assert.equal(none.decision, "no_parseable_offer");

  await assert.rejects(
    paymentOfferPreflight("https://user:pass@api.example.com/paid"),
    PaymentOfferPreflightError,
  );
});

test("settlement_proof handler output covers every MCP schema-required path", async () => {
  const verified = await runSettlement();
  assertSchemaMatchesHandler(settlementProofMcpOutputSchema, verified);
  assert.equal(verified.decision, "verified");

  const notVerified = await runSettlement({ logs: [transfer(SETTLEMENT_PAYER, SETTLEMENT_OTHER)] });
  assertSchemaMatchesHandler(settlementProofMcpOutputSchema, notVerified);
  assert.equal(notVerified.decision, "not_verified");

  const blockMissing = await runSettlement({ blockError: true });
  assertSchemaMatchesHandler(settlementProofMcpOutputSchema, blockMissing);
  assert.equal(blockMissing.decision, "not_verified");
  assert.equal(blockMissing.settlement.observed.amountAtomic, "5000");

  const unavailable = await runSettlement({ receiptError: true });
  assertSchemaMatchesHandler(settlementProofMcpOutputSchema, unavailable);
  assert.equal(unavailable.decision, "receipt_unavailable");
  assert.equal(unavailable.ok, false);

  await assert.rejects(() => settlementProof({ ...SETTLEMENT_INPUT, transactionHash: "0x12" }));
});

test("contract_qualified_search handler output covers every MCP schema-required path", async () => {
  const qualified = await runSearch();
  assertSchemaMatchesHandler(contractQualifiedSearchMcpOutputSchema, qualified);
  assert.equal(qualified.decision, "qualified_candidates_found");

  const rejected = await runSearch({
    request: { ...SEARCH_REQUEST, limit: 1 },
    mpp: { services: [] },
    auditImpl: async () => ({
      ok: false,
      machineBuyable: false,
      routes: [{
        findings: ["seller_response_required_path_missing:data.sourceRepository"],
        responseContract: { decision: "underconstrained", guaranteedPaths: [] },
      }],
    }),
  });
  assertSchemaMatchesHandler(contractQualifiedSearchMcpOutputSchema, rejected);
  assert.equal(rejected.decision, "no_qualified_candidate");
  assert.equal(rejected.rejected[0].reason, "response_contract_incomplete");

  const postReady = await runSearch({
    request: { ...SEARCH_REQUEST, limit: 1 },
    agent402: { results: [{ seller: "https://post.example", sellerName: "Post", url: "https://post.example/analyze", route: "/analyze", method: "POST", priceUsd: 0.01, payable: "x402", description: "source repository provenance", score: 20 }] },
    mpp: { services: [] },
    auditImpl: async () => ({
      ok: true,
      machineBuyable: false,
      routes: [{
        protocols: ["x402"],
        runtimeChallengeVerified: false,
        findings: [],
        responseContract: { decision: "admissible", guaranteedPaths: ["data.sourceRepository"] },
      }],
    }),
  });
  assertSchemaMatchesHandler(contractQualifiedSearchMcpOutputSchema, postReady);
  assert.equal(postReady.qualified[0].decision, "contract_ready");

  assert.throws(() => normalizeContractQualifiedSearchInput({ query: "too-short" }), /10 to 300/);
});

test("MCP tools/list advertises the three Zod output schemas without a paid call", async () => {
  const server = new McpServer({ name: "x402-data-gateway", version: "test" });
  const tools = [
    { name: "payment_offer_preflight", schema: paymentOfferPreflightMcpOutputSchema, input: { url: z.string() } },
    { name: "contract_qualified_search", schema: contractQualifiedSearchMcpOutputSchema, input: { query: z.string() } },
    { name: "settlement_proof", schema: settlementProofMcpOutputSchema, input: { transactionHash: z.string() } },
  ];
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.name,
      inputSchema: tool.input,
      outputSchema: tool.schema,
    }, async () => asToolResult({ ok: true }, { structured: true }));
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  await client.close();
  await server.close();

  for (const tool of tools) {
    const advertised = listed.tools.find((entry) => entry.name === tool.name);
    assert.ok(advertised, `missing ${tool.name} in tools/list`);
    const objects = advertisedObjectSchemas(advertised.outputSchema);
    for (const objectSchema of objects) {
      assert.equal(objectSchema.type, "object");
      assert.equal(objectSchema.additionalProperties, false);
    }
    const advertisedRequired = new Set(objects.flatMap((objectSchema) => objectSchema.required || []));
    for (const path of requiredPathsFromSchema(tool.schema).filter((item) => !item.includes("."))) {
      assert.equal(advertisedRequired.has(path), true, `${tool.name} tools/list omitted required ${path}`);
    }
  }
});

test("structuredContent is attached only when an output schema exists, and throw paths stay unstructured", async () => {
  const value = { ok: true, decision: "parseable_offer" };
  assert.equal("structuredContent" in asToolResult(value), false);
  assert.deepEqual(asToolResult(value, { structured: true }).structuredContent, value);

  const thrown = { ...asToolResult({ ok: false, error: "invalid url" }), isError: true };
  assert.equal(thrown.isError, true);
  assert.equal("structuredContent" in thrown, false);

  const server = new McpServer({ name: "x402-data-gateway", version: "test" });
  const parseable = await runPreflight();
  const verified = await runSettlement();
  const qualified = await runSearch();
  const payloads = {
    payment_offer_preflight: parseable,
    settlement_proof: verified,
    contract_qualified_search: qualified,
  };
  for (const [name, schema] of [
    ["payment_offer_preflight", paymentOfferPreflightMcpOutputSchema],
    ["settlement_proof", settlementProofMcpOutputSchema],
    ["contract_qualified_search", contractQualifiedSearchMcpOutputSchema],
  ]) {
    server.registerTool(name, {
      description: name,
      inputSchema: { noop: z.string().optional() },
      outputSchema: schema,
    }, async () => asToolResult(payloads[name], { structured: true }));
  }
  server.registerTool("throwing_tool", {
    description: "throwing_tool",
    inputSchema: { noop: z.string().optional() },
  }, async () => ({ ...asToolResult({ ok: false, error: "handler failed" }), isError: true }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-call-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const name of Object.keys(payloads)) {
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(Boolean(result.isError), false, `${name} tools/call isError=${result.isError} ${JSON.stringify(result.content)}`);
    assert.deepEqual(result.structuredContent, JSON.parse(JSON.stringify(payloads[name])));
  }
  const failed = await client.callTool({ name: "throwing_tool", arguments: {} });
  assert.equal(failed.isError, true);
  assert.equal("structuredContent" in failed, false);
  await client.close();
  await server.close();
});
