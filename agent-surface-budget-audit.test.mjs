import assert from "node:assert/strict";
import test from "node:test";

import {
  agentSurfaceBudgetAudit,
  normalizeAgentSurfaceBudgetAuditInput,
  resolveAuditAddress,
} from "./agent-surface-budget-audit.mjs";

const request = { origin: "https://example.com", mcpBudgetBytes: 8192, openApiBudgetBytes: 32768 };

test("normalizes only public exact discovery surfaces", () => {
  assert.deepEqual({ ...normalizeAgentSurfaceBudgetAuditInput(request) }, {
    origin: "https://example.com",
    mcpPath: "/mcp",
    openApiPath: "/openapi.json",
    mcpBudgetBytes: 8192,
    openApiBudgetBytes: 32768,
  });
  assert.throws(() => normalizeAgentSurfaceBudgetAuditInput({ origin: "http://example.com" }), /public HTTPS/);
  assert.throws(() => normalizeAgentSurfaceBudgetAuditInput({ origin: "https://example.com/private" }), /must not contain/);
  assert.throws(() => normalizeAgentSurfaceBudgetAuditInput({ origin: "https://example.com", mcpPath: "//evil.test" }), /root-relative/);
  assert.throws(() => normalizeAgentSurfaceBudgetAuditInput({ origin: "https://example.com", token: "secret" }), /unsupported/);
});

test("uses validated public DNS when the desktop resolver synthesizes a benchmark address", async () => {
  const result = await resolveAuditAddress("example.com", {
    lookupImpl: async () => [{ address: "198.18.0.93", family: 4 }],
    dohFetchImpl: async (url) => jsonDns(url.searchParams.get("type") === "A"
      ? [{ type: 1, data: "93.184.216.34" }]
      : []),
  });
  assert.deepEqual(result, { address: "93.184.216.34", family: 4 });
});

test("public DNS fallback still rejects private target answers", async () => {
  await assert.rejects(() => resolveAuditAddress("private.example", {
    lookupImpl: async () => [{ address: "198.18.0.93", family: 4 }],
    dohFetchImpl: async (url) => jsonDns(url.searchParams.get("type") === "A"
      ? [{ type: 1, data: "127.0.0.1" }]
      : []),
  }), /non-public/);
});

function jsonDns(answers) {
  return new Response(JSON.stringify({ Status: 0, Answer: answers }), { status: 200, headers: { "content-type": "application/dns-json" } });
}

test("measures surfaces and recommends progressive discovery without returning schemas", async () => {
  const result = await agentSurfaceBudgetAudit(request, {
    now: () => new Date("2026-08-12T15:00:00.000Z"),
    mcpAcquireImpl: async () => ({
      bytes: 9000,
      protocolVersion: "2025-11-25",
      server: { name: "fixture", version: "1.0.0" },
      tools: [
        { name: "heavy", title: "Heavy", description: "x".repeat(8000), inputSchema: { type: "object", properties: { value: { type: "string" } } } },
        { name: "small", title: "Small", description: "small", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
      ],
    }),
    openApiAcquireImpl: async () => ({
      bytes: 1000,
      document: { paths: { "/x": { get: { operationId: "getX", summary: "Get X", responses: { 200: { description: "ok" } } } } } },
    }),
  });
  assert.equal(result.decision, "optimize");
  assert.equal(result.mcp.toolCount, 2);
  assert.equal(result.mcp.heaviestTools[0].name, "heavy");
  assert.equal(result.openapi.operationCount, 1);
  assert.match(result.actions.join(" "), /progressive MCP tool discovery/);
  assert.match(result.actions.join(" "), /outputSchema/);
  assert.equal(result.boundary.toolsCalled, false);
  assert.equal(JSON.stringify(result).includes("properties\":{\"value"), false);
});

test("fails one surface closed while preserving the other measurement", async () => {
  const result = await agentSurfaceBudgetAudit(request, {
    mcpAcquireImpl: async () => { throw new Error("/mcp returned HTTP 404"); },
    openApiAcquireImpl: async () => ({ bytes: 100, document: { paths: {} } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.decision, "surface_incomplete");
  assert.equal(result.mcp.failureCode, "surface_unavailable");
  assert.equal(result.openapi.available, true);
  assert.match(result.actions.join(" "), /Publish a bounded credential-free MCP/);
});

test("returns within_budget only when both surfaces fit", async () => {
  const result = await agentSurfaceBudgetAudit(request, {
    mcpAcquireImpl: async () => ({ bytes: 100, protocolVersion: "2025-11-25", server: {}, tools: [{ name: "x", title: "X", description: "X", inputSchema: { type: "object" }, outputSchema: { type: "object" } }] }),
    openApiAcquireImpl: async () => ({ bytes: 100, document: { paths: { "/x": { get: { operationId: "getX" } } } } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "within_budget");
  assert.equal(result.actions.length, 0);
});

test("reports bounded MCP pagination without exposing a cursor", async () => {
  const result = await agentSurfaceBudgetAudit(request, {
    mcpAcquireImpl: async () => ({
      bytes: 200,
      pages: 2,
      protocolVersion: "2025-11-25",
      server: {},
      tools: [
        { name: "one", title: "One", description: "One", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
        { name: "two", title: "Two", description: "Two", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
      ],
    }),
    openApiAcquireImpl: async () => ({ bytes: 100, document: { paths: {} } }),
  });
  assert.equal(result.mcp.pageCount, 2);
  assert.equal(result.mcp.toolCount, 2);
  assert.equal(JSON.stringify(result).includes("cursor"), false);
});
