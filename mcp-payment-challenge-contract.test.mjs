import assert from "node:assert/strict";
import test from "node:test";

import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import { agentSurfaceBudgetAuditMcpOutputSchema } from "./agent-surface-budget-audit.mjs";
import { contractQualifiedSearchMcpOutputSchema } from "./contract-qualified-search.mjs";
import { extractBatchMcpOutputSchema } from "./extract-batch.mjs";
import { extractMcpOutputSchema, readMcpOutputSchema } from "./extract.mjs";
import { lockfilePinDeltaMcpOutputSchema } from "./lockfile-pin-delta.mjs";
import { withoutSchemaRejectedErrorStructuredContent, mountMcp } from "./mcp-server.mjs";
import { morphoPreLiquidationReplayMcpOutputSchema } from "./morpho-preliquidation-replay.mjs";
import { morphoProtectionMcpOutputSchema } from "./morpho-protection.mjs";
import { opportunityPreflight, opportunityPreflightMcpOutputSchema } from "./opportunity-preflight.mjs";
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
const PREFLIGHT_ARGS = Object.freeze({ rewardUsd: 10, hours: 1, hourlyCostUsd: 50 });
const SAMPLE_CHALLENGE = Object.freeze({
  x402Version: 2,
  resource: { url: "https://agents.samedaydesk.com/mcp", description: "sample", mimeType: "application/json" },
  accepts: [{
    scheme: "exact",
    network: NETWORK,
    amount: "10000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    asset: `0x${"11".repeat(20)}`,
  }],
});
const CAREERS_ERROR = Object.freeze({
  ok: false,
  product: "samedaydesk-careers-board",
  charged: false,
  board: "acxiom",
  outcome: "unavailable",
  rows: [],
  coverage: { status: "source_failure" },
  source: { name: "fixture" },
  fetchedAt: null,
  roleFilter: null,
});
const INVALID_ERROR = Object.freeze({ ok: false, error: "not_a_preflight", charged: false });

// Same required shape the mounted careers_board tool registers in server.js.
const careersBoardMcpOutputSchema = z.object({
  ok: z.boolean(),
  product: z.string(),
  charged: z.boolean(),
  board: z.string(),
  outcome: z.string(),
  rows: z.array(z.object({
    title: z.string(),
    location: z.string().nullable(),
    url: z.string(),
    source: z.string(),
    fetchedAt: z.string(),
  }).passthrough()),
  coverage: z.record(z.string(), z.any()),
  source: z.record(z.string(), z.any()),
  fetchedAt: z.string().nullable(),
  roleFilter: z.null(),
}).passthrough();

const permissiveChallengeSchema = z.object({
  x402Version: z.number().int(),
  accepts: z.array(z.any()),
}).passthrough();

const REGISTERED_SCHEMAS = Object.freeze([
  ["extract", extractMcpOutputSchema],
  ["read", readMcpOutputSchema],
  ["extract_batch", extractBatchMcpOutputSchema],
  ["lockfile_pin_delta", lockfilePinDeltaMcpOutputSchema],
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
  ["careers_board", careersBoardMcpOutputSchema],
]);

function schemaAccepts(schema, body) {
  try {
    return typeof schema?.safeParse === "function" && schema.safeParse(body).success === true;
  } catch {
    return false;
  }
}

function paymentRequiredText(result) {
  const text = result?.content?.[0]?.text;
  assert.equal(typeof text, "string");
  const parsed = JSON.parse(text);
  assert.equal(Number.isInteger(parsed?.x402Version), true);
  assert.equal(Array.isArray(parsed?.accepts), true);
  return parsed;
}

function decodeMcpMessages(buffer, contentType) {
  const text = Buffer.from(buffer || []).toString("utf8");
  if (!text) return [];
  if (String(contentType || "").includes("text/event-stream")) {
    return text.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return [JSON.parse(text)];
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

function toolEntry(name, outputSchema, extra = {}) {
  return {
    name,
    description: name,
    price: "$0.01",
    inputSchema: extra.inputSchema || { tick: z.number().optional() },
    ...(outputSchema ? { outputSchema } : {}),
    run: extra.run || (async () => {
      throw new Error(`${name} run was not part of this case`);
    }),
    ...extra,
  };
}

test("schema rejection removes only the structured copy of an error", () => {
  const challengeResult = {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(SAMPLE_CHALLENGE) }],
    structuredContent: SAMPLE_CHALLENGE,
  };
  const rejectedNames = [];
  for (const [name, schema] of REGISTERED_SCHEMAS) {
    const accepted = schemaAccepts(schema, SAMPLE_CHALLENGE);
    const exposed = withoutSchemaRejectedErrorStructuredContent(challengeResult, schema);
    if (accepted) {
      assert.equal(exposed.structuredContent, SAMPLE_CHALLENGE, name);
    } else {
      rejectedNames.push(name);
      assert.equal(exposed.structuredContent, undefined, name);
      assert.equal(JSON.parse(exposed.content[0].text).x402Version, 2, name);
    }
    assert.equal(challengeResult.structuredContent, SAMPLE_CHALLENGE);
  }
  for (const name of ["extract", "extract_batch", "opportunity_preflight", "careers_board"]) {
    assert.equal(rejectedNames.includes(name), true, name);
  }

  const valid = opportunityPreflight(PREFLIGHT_ARGS);
  assert.equal(opportunityPreflightMcpOutputSchema.safeParse(valid).success, true);
  const keptError = withoutSchemaRejectedErrorStructuredContent({
    isError: true,
    content: [{ type: "text", text: JSON.stringify(valid) }],
    structuredContent: valid,
  }, opportunityPreflightMcpOutputSchema);
  assert.equal(keptError.structuredContent, valid);
  const success = withoutSchemaRejectedErrorStructuredContent({
    content: [{ type: "text", text: JSON.stringify(valid) }],
    structuredContent: valid,
  }, opportunityPreflightMcpOutputSchema);
  assert.equal(success.structuredContent, valid);
  assert.equal(withoutSchemaRejectedErrorStructuredContent(challengeResult, undefined).structuredContent, SAMPLE_CHALLENGE);
  assert.equal(withoutSchemaRejectedErrorStructuredContent(challengeResult, permissiveChallengeSchema).structuredContent, SAMPLE_CHALLENGE);
  assert.equal(careersBoardMcpOutputSchema.safeParse(CAREERS_ERROR).success, true);
  assert.equal(opportunityPreflightMcpOutputSchema.safeParse(INVALID_ERROR).success, false);
  assert.equal(permissiveChallengeSchema.safeParse(SAMPLE_CHALLENGE).success, true);
});

test("registered schemas keep an ordinary payment challenge readable by the official client", async () => {
  const calls = { settle: 0 };
  const app = express();
  const tools = [
    ...REGISTERED_SCHEMAS
      .filter(([name]) => !["opportunity_preflight", "careers_board", "read"].includes(name))
      .map(([name, schema]) => toolEntry(name, schema)),
    toolEntry("opportunity_preflight", opportunityPreflightMcpOutputSchema, {
      inputSchema: {
        rewardUsd: z.number(),
        hours: z.number(),
        hourlyCostUsd: z.number(),
      },
      run: (args) => opportunityPreflight(args),
    }),
    toolEntry("careers_board", careersBoardMcpOutputSchema, {
      returnMcpResult: true,
      run: async () => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify(CAREERS_ERROR) }],
        structuredContent: CAREERS_ERROR,
      }),
    }),
    toolEntry("read", readMcpOutputSchema, {
      returnMcpResult: true,
      run: async () => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify(INVALID_ERROR) }],
        structuredContent: INVALID_ERROR,
      }),
    }),
    toolEntry("morpho_position", null, {
      inputSchema: { address: z.string().optional() },
      run: async () => ({ ok: true }),
    }),
  ];
  await mountMcp(app, {
    facilitatorClient: {
      async getSupported() {
        return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [] };
      },
      async verify() {
        return { isValid: true, payer: PAYER };
      },
      async settle() {
        calls.settle += 1;
        return { success: true, transaction: `0x${calls.settle.toString(16).padStart(64, "0")}`, network: NETWORK };
      },
    },
    network: NETWORK,
    payTo: PAY_TO,
    serverInfo: { name: "payment-challenge-contract", version: "1" },
    tools,
  });
  const server = app.listen(0, "127.0.0.1");
  const origin = await new Promise((resolve, reject) => {
    server.once("listening", () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.once("error", reject);
  });
  let id = 1;
  const post = async (body) => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(body),
    });
    const messages = decodeMcpMessages(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type"));
    return messages.find((message) => message?.result)?.result ?? null;
  };
  const challengeFor = async (name, args = {}) => post({
    jsonrpc: "2.0",
    id: id++,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const pay = async (name, args = {}) => {
    const unpaid = await challengeFor(name, args);
    const body = paymentRequiredText(unpaid);
    const paid = await post({
      jsonrpc: "2.0",
      id: id++,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: { "x402/payment": payment(body.accepts[0]) },
      },
    });
    return { unpaid, paid };
  };
  const client = new Client({ name: "payment-challenge-contract", version: "1" });
  try {
    const affected = [];
    for (const [name, schema] of REGISTERED_SCHEMAS) {
      const result = await challengeFor(name, name === "opportunity_preflight" ? PREFLIGHT_ARGS : {});
      assert.equal(result?.isError, true, name);
      const body = paymentRequiredText(result);
      const accepted = schemaAccepts(schema, body);
      if (accepted) {
        assert.deepEqual(result.structuredContent, body, name);
      } else {
        affected.push(name);
        assert.equal(result.structuredContent, undefined, name);
      }
    }
    for (const name of ["extract", "extract_batch", "opportunity_preflight", "careers_board"]) {
      assert.equal(affected.includes(name), true, affected.join(","));
    }

    const plain = await challengeFor("morpho_position");
    const plainBody = paymentRequiredText(plain);
    assert.equal(plain.isError, true);
    assert.deepEqual(plain.structuredContent, plainBody);

    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
    const official = await client.callTool({ name: "opportunity_preflight", arguments: PREFLIGHT_ARGS });
    assert.equal(official.isError, true);
    assert.equal(official.structuredContent, undefined);
    assert.equal(paymentRequiredText(official).x402Version, 2);

    const success = await pay("opportunity_preflight", PREFLIGHT_ARGS);
    assert.equal(Boolean(success.paid?.isError), false, JSON.stringify(success.paid));
    assert.equal(opportunityPreflightMcpOutputSchema.safeParse(success.paid.structuredContent).success, true);
    assert.deepEqual(JSON.parse(success.paid.content[0].text), success.paid.structuredContent);

    const validError = await pay("careers_board");
    assert.equal(validError.paid?.isError, true);
    assert.deepEqual(validError.paid.structuredContent, CAREERS_ERROR);

    const invalidError = await pay("read");
    assert.equal(invalidError.paid?.isError, true);
    assert.equal(invalidError.paid.structuredContent, undefined);
    assert.deepEqual(JSON.parse(invalidError.paid.content[0].text), INVALID_ERROR);
    // The successful preflight settles once. The schema-valid and schema-invalid
    // error results are not additional settlements.
    assert.equal(calls.settle, 1);
  } finally {
    await client.close().catch(() => {});
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
