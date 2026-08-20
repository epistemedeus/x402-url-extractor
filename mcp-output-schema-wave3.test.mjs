import assert from "node:assert/strict";
import test from "node:test";

import Ajv from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { asToolResult } from "./mcp-server.mjs";
import { agentSurfaceBudgetAuditMcpOutputSchema } from "./agent-surface-budget-audit.mjs";
import { contractQualifiedSearchMcpOutputSchema } from "./contract-qualified-search.mjs";
import { morphoPreLiquidationReplayMcpOutputSchema } from "./morpho-preliquidation-replay.mjs";
import { morphoProtectionMcpOutputSchema } from "./morpho-protection.mjs";
import { paymentOfferPreflightMcpOutputSchema } from "./payment-offer-preflight.mjs";
import { getPlatformHealthCard } from "./platform-health.mjs";
import { scanRepoMcpOutputSchema } from "./scan.mjs";
import { settlementProofMcpOutputSchema } from "./settlement-proof.mjs";
import {
  opportunityPreflight,
  opportunityPreflightMcpOutputSchema,
  opportunityPreflightOutputSchema,
  opportunityPreflightTrial,
} from "./opportunity-preflight.mjs";
import {
  WALLET_POLICY_CASES,
  walletPolicyConformance,
  walletPolicyConformanceMcpOutputSchema,
  walletPolicyConformanceOutputSchema,
} from "./wallet-policy-conformance.mjs";
import {
  STATEFUL_WALLET_POLICY_CASES,
  statefulWalletPolicyConformance,
  statefulWalletPolicyConformanceMcpOutputSchema,
  statefulWalletPolicyConformanceOutputSchema,
} from "./stateful-wallet-policy-conformance.mjs";

const ajv = new Ajv({ allErrors: true, strict: false });

function compileJsonSchema(schema) {
  const clone = structuredClone(schema);
  delete clone.$schema;
  return ajv.compile(clone);
}

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

function assertAjvMatchesHandler(jsonSchema, value) {
  const validate = compileJsonSchema(jsonSchema);
  const encoded = JSON.parse(JSON.stringify(value));
  assert.equal(validate(encoded), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(validate({ ...encoded, extra: true }), false);
  for (const field of jsonSchema.required || []) {
    const { [field]: _removed, ...rest } = encoded;
    assert.equal(validate(rest), false, `AJV accepted payload missing required ${field}`);
  }
}

function assertJsonZodParity(jsonSchema, zodSchema) {
  const jsonRequired = [...(jsonSchema.required || [])].sort();
  const zodRequired = requiredPathsFromSchema(zodSchema).filter((path) => !path.includes(".")).sort();
  assert.deepEqual(zodRequired, jsonRequired);
  assert.equal(jsonSchema.additionalProperties, false);
}

const PRIOR_TYPED_MCP = Object.freeze([
  ["scan", scanRepoMcpOutputSchema, ["ok", "repo", "branch", "filesScanned", "risk", "summary", "findings", "disclaimer", "scannedAt"]],
  ["morpho_protection", morphoProtectionMcpOutputSchema, ["ok", "product", "version", "address", "chain", "fetchedAt", "latestIndexedAt", "inputs", "positionCount", "actionableCount", "unverifiedCount", "quotes", "source", "invariants", "boundary"]],
  ["morpho_preliquidation_replay", morphoPreLiquidationReplayMcpOutputSchema, ["ok", "product", "version", "chain", "transaction", "eventCount", "events", "verification", "boundary"]],
  ["payment_offer_preflight", paymentOfferPreflightMcpOutputSchema, ["ok", "product", "version", "checkedAt", "target", "decision", "protocols", "offerCount", "offers", "parity", "catalogCoherence", "responseContract", "responseContractAcquisition", "findings", "boundary"]],
  ["contract_qualified_search", contractQualifiedSearchMcpOutputSchema, ["ok", "product", "version", "checkedAt", "decision", "request", "sources", "qualified", "rejected", "boundary"]],
  ["settlement_proof", settlementProofMcpOutputSchema, ["ok", "product", "version", "checkedAt", "decision", "request", "chain", "asset", "transaction", "settlement", "findings", "boundary"]],
  ["agent_surface_budget_audit", agentSurfaceBudgetAuditMcpOutputSchema, ["ok", "product", "version", "checkedAt", "decision", "request", "mcp", "openapi", "actions", "boundary"]],
]);

const opportunityBase = {
  rewardUsd: 10,
  hours: 0.25,
  hourlyCostUsd: 4,
  computeUsd: 0.5,
  mandatorySpendUsd: 0,
  reusableValueUsd: 1,
  selectionProbabilityPct: 80,
  competition: 1,
  slots: 1,
  agentAccess: "agent_allowed",
  acceptance: "deterministic",
  settlement: "escrow",
};

function walletSafe(caseName, actual, denialClass = actual === "allowed" ? "none" : "policy") {
  return {
    case: caseName,
    actual,
    denialClass,
    code: actual === "allowed" ? "signed" : "policy_violation",
  };
}

function walletComplete() {
  return Object.entries(WALLET_POLICY_CASES)
    .filter(([, definition]) => definition.required)
    .map(([caseName, definition]) => walletSafe(caseName, definition.expected === "allow" ? "allowed" : "denied"));
}

function statefulSafe(caseName, actual, enforcementClass = actual === "allowed" ? "none" : "policy") {
  return {
    case: caseName,
    actual,
    enforcementClass,
    code: actual === "allowed" ? "signed" : "policy_violation",
  };
}

function statefulComplete() {
  return Object.entries(STATEFUL_WALLET_POLICY_CASES)
    .filter(([, definition]) => definition.required)
    .map(([caseName, definition]) => statefulSafe(caseName, definition.expected === "allow" ? "allowed" : "denied"));
}

test("prior seven typed MCP outputs keep their required contracts", () => {
  assert.equal(PRIOR_TYPED_MCP.length, 7);
  for (const [name, schema, required] of PRIOR_TYPED_MCP) {
    const actual = requiredPathsFromSchema(schema).filter((path) => !path.includes("."));
    assert.deepEqual(actual, required, `${name} required fields drifted`);
    assert.equal(schema.safeParse({ extra: true }).success, false);
  }
});

test("opportunity-preflight JSON Schema and MCP Zod stay in required-key parity", () => {
  assertJsonZodParity(opportunityPreflightOutputSchema(), opportunityPreflightMcpOutputSchema);
});

test("opportunity-preflight handler outputs pass AJV and MCP Zod", () => {
  const attempt = opportunityPreflight(opportunityBase);
  const abandon = opportunityPreflight({ ...opportunityBase, agentAccess: "human_only" });
  const verify = opportunityPreflight({ ...opportunityBase, selectionProbabilityPct: undefined });
  const card = getPlatformHealthCard("taskmarket", new Date("2026-08-09T08:00:00Z"));
  const evidenced = opportunityPreflight({
    ...opportunityBase,
    platform: "taskmarket",
    competition: 80,
    selectionProbabilityPct: 2,
  }, { platformCard: card });
  for (const value of [attempt, abandon, verify, evidenced]) {
    assertAjvMatchesHandler(opportunityPreflightOutputSchema(), value);
    assertSchemaMatchesHandler(opportunityPreflightMcpOutputSchema, value);
  }
  assert.equal(evidenced.platformEvidence.evidence[0].factClass.length > 0, true);
});

test("paid opportunity-preflight POST and MCP schemas reject trial-only fields", () => {
  const trial = JSON.parse(JSON.stringify(opportunityPreflightTrial()));
  const validatePaid = compileJsonSchema(opportunityPreflightOutputSchema());
  assert.equal(validatePaid(trial), false);
  assert.ok((validatePaid.errors || []).some((error) => (
    error.keyword === "additionalProperties"
    && ["sample", "charged", "trial"].includes(error.params?.additionalProperty)
  )));
  assert.equal(opportunityPreflightMcpOutputSchema.safeParse(trial).success, false);
});

test("wallet-policy-conformance JSON Schema and MCP Zod stay in required-key parity", () => {
  assertJsonZodParity(walletPolicyConformanceOutputSchema(), walletPolicyConformanceMcpOutputSchema);
});

test("wallet-policy-conformance handler outputs pass AJV and MCP Zod", () => {
  const conformant = walletPolicyConformance({
    profileId: "privy-solana-lab",
    provider: "Privy",
    network: "solana:mainnet",
    protocol: "x402",
    observations: walletComplete(),
  });
  const unsafe = walletPolicyConformance({
    profileId: "privy-solana-lab",
    provider: "Privy",
    network: "solana:mainnet",
    protocol: "x402",
    observations: walletComplete().map((row) => (
      row.case === "duplicate_approved_action" ? walletSafe(row.case, "allowed") : row
    )),
  });
  const partial = walletPolicyConformance({
    profileId: "privy-solana-lab",
    provider: "Privy",
    network: "solana:mainnet",
    protocol: "x402",
    observations: [walletSafe("intended", "allowed"), walletSafe("wrong_operation", "denied")],
  });
  for (const value of [conformant, unsafe, partial]) {
    assertAjvMatchesHandler(walletPolicyConformanceOutputSchema(), value);
    assertSchemaMatchesHandler(walletPolicyConformanceMcpOutputSchema, value);
  }
});

test("stateful-wallet-policy-conformance JSON Schema and MCP Zod stay in required-key parity", () => {
  assertJsonZodParity(statefulWalletPolicyConformanceOutputSchema(), statefulWalletPolicyConformanceMcpOutputSchema);
});

test("stateful-wallet-policy-conformance handler outputs pass AJV and MCP Zod", () => {
  const conformant = statefulWalletPolicyConformance({
    profileId: "provider-stateful-lab",
    provider: "Example Wallet",
    network: "eip155:8453",
    protocol: "x402",
    observations: statefulComplete(),
  });
  const unsafe = statefulWalletPolicyConformance({
    profileId: "provider-stateful-lab",
    provider: "Example Wallet",
    network: "eip155:8453",
    protocol: "x402",
    observations: statefulComplete().map((row) => (
      ["unrecognized_calldata", "concurrent_exceeds_cap"].includes(row.case)
        ? statefulSafe(row.case, "allowed")
        : row
    )),
  });
  const application = statefulWalletPolicyConformance({
    profileId: "provider-stateful-lab",
    provider: "Example Wallet",
    network: "eip155:8453",
    protocol: "x402",
    observations: [
      ...statefulComplete(),
      statefulSafe("application_serialized_concurrent_exceeds_cap", "denied", "application"),
    ],
  });
  for (const value of [conformant, unsafe, application]) {
    assertAjvMatchesHandler(statefulWalletPolicyConformanceOutputSchema(), value);
    assertSchemaMatchesHandler(statefulWalletPolicyConformanceMcpOutputSchema, value);
  }
});

test("MCP tools/list advertises the three POST output schemas without a paid call", async () => {
  const server = new McpServer({ name: "x402-data-gateway", version: "test" });
  const tools = [
    { name: "opportunity_preflight", schema: opportunityPreflightMcpOutputSchema, input: { rewardUsd: z.number() } },
    { name: "wallet_policy_conformance", schema: walletPolicyConformanceMcpOutputSchema, input: { profileId: z.string() } },
    { name: "stateful_wallet_policy_conformance", schema: statefulWalletPolicyConformanceMcpOutputSchema, input: { profileId: z.string() } },
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

  assert.equal(listed.tools.filter((tool) => tool.outputSchema).length, 3);
  for (const tool of tools) {
    const advertised = listed.tools.find((entry) => entry.name === tool.name);
    assert.ok(advertised, `missing ${tool.name} in tools/list`);
    assert.equal(advertised.outputSchema?.type, "object");
    assert.equal(advertised.outputSchema.additionalProperties, false);
    for (const path of requiredPathsFromSchema(tool.schema).filter((item) => !item.includes("."))) {
      assert.equal(advertised.outputSchema.required.includes(path), true, `${tool.name} tools/list omitted required ${path}`);
    }
  }
});

test("structuredContent is attached for the three POST tools and throw paths stay unstructured", async () => {
  const attempt = opportunityPreflight(opportunityBase);
  const wallet = walletPolicyConformance({
    profileId: "privy-solana-lab",
    provider: "Privy",
    network: "solana:mainnet",
    protocol: "x402",
    observations: walletComplete(),
  });
  const stateful = statefulWalletPolicyConformance({
    profileId: "provider-stateful-lab",
    provider: "Example Wallet",
    network: "eip155:8453",
    protocol: "x402",
    observations: statefulComplete(),
  });
  const payloads = {
    opportunity_preflight: attempt,
    wallet_policy_conformance: wallet,
    stateful_wallet_policy_conformance: stateful,
  };
  const server = new McpServer({ name: "x402-data-gateway", version: "test" });
  for (const [name, schema] of [
    ["opportunity_preflight", opportunityPreflightMcpOutputSchema],
    ["wallet_policy_conformance", walletPolicyConformanceMcpOutputSchema],
    ["stateful_wallet_policy_conformance", statefulWalletPolicyConformanceMcpOutputSchema],
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
