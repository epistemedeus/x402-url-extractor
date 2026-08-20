import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, ListToolsResultSchema, ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { listMcpToolMetadata } from "./mcp-tool-metadata.mjs";
import {
  compactCatalog,
  compactJsonBytes,
  CURSOR_PAGE_SIZE_USED_BY_NAIVE_CLIENT_REPROS,
  evaluateServerSideDiscoveryChange,
  measureToolsList,
  naiveClientCollect,
  paginateToolsList,
  specClientCollect,
  tokenEstimate,
} from "./mcp-progressive-discovery.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(cwd, "mcp-progressive-discovery.fixture.json"), "utf8"));
const mcpServerSource = readFileSync(path.join(cwd, "mcp-server.mjs"), "utf8");

function syntheticTools(count, { schemaChars = 80 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${String(index + 1).padStart(2, "0")}`,
    title: `Tool ${index + 1}`,
    description: `Synthetic tool ${index + 1} for pagination and catalog measurements.`,
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "x".repeat(schemaChars) },
      },
      required: ["value"],
    },
    _meta: {
      x402: {
        paymentRequired: true,
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: String((index + 1) * 1000) }],
      },
    },
  }));
}

function validListResult(tools, extra = {}) {
  return { tools, ...extra };
}

test("live snapshot keeps 22 named paid tools on one complete tools/list page", () => {
  const metadata = listMcpToolMetadata();
  assert.equal(metadata.length, 22);
  assert.equal(fixture.tools.length, 22);
  assert.equal(fixture.nextCursor, null);
  assert.deepEqual(fixture.tools.map((tool) => tool.name), metadata.map((entry) => entry.name));
  assert.deepEqual(fixture.tools.map((tool) => tool.title), metadata.map((entry) => entry.title));
  for (const tool of fixture.tools) {
    assert.equal(tool.amountAtomic && Number(tool.amountAtomic) > 0, true);
    assert.match(tool.amountAtomic, /^[1-9][0-9]*$/);
  }
  assert.equal(new Set(fixture.tools.map((tool) => tool.name)).size, 22);
  assert.equal(fixture.payTo, "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee");
  assert.equal(fixture.network, "eip155:8453");
  assert.equal(fixture.asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(fixture.sseBytes, 44743);
  assert.equal(tokenEstimate(fixture.sseBytes), 11186);
});

test("byte and token measurements split schemas, copy, and payment metadata", () => {
  const tools = syntheticTools(4, { schemaChars: 200 });
  tools[0].outputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
  const measured = measureToolsList(validListResult(tools), { wireBytes: 4096 });
  assert.equal(measured.toolCount, 4);
  assert.equal(measured.complete, true);
  assert.equal(measured.nextCursor, null);
  assert.equal(measured.paymentRequiredCount, 4);
  assert.equal(measured.missingInputSchemaCount, 0);
  assert.equal(measured.wireBytes, 4096);
  assert.equal(measured.wireTokenEstimate, 1024);
  assert.ok(measured.fieldBytes.inputSchemas > measured.fieldBytes.names);
  assert.ok(measured.fieldBytes.meta > 0);
  assert.ok(measured.compactCatalogBytes < measured.resultBytes);
  assert.ok(measured.nameOnlyCatalogBytes < measured.compactCatalogBytes);
  assert.equal(measured.heaviestTools[0].name, "tool_01");
});

test("a compact catalog is not a valid MCP tools/list result", () => {
  const tools = syntheticTools(3);
  const compact = compactCatalog(tools, "name_title_description");
  const parsedCompact = ListToolsResultSchema.safeParse({ tools: compact });
  const parsedFull = ListToolsResultSchema.safeParse(validListResult(tools));
  assert.equal(parsedFull.success, true);
  assert.equal(parsedCompact.success, false);
  assert.equal(ToolSchema.safeParse(compact[0]).success, false);
  assert.equal(ToolSchema.safeParse(tools[0]).success, true);
});

test("spec-legal pagination hides tools from a single-page client", () => {
  const tools = syntheticTools(14);
  const firstPage = paginateToolsList(tools, { pageSize: CURSOR_PAGE_SIZE_USED_BY_NAIVE_CLIENT_REPROS });
  assert.equal(firstPage.tools.length, 8);
  assert.equal(typeof firstPage.nextCursor, "string");
  assert.deepEqual(naiveClientCollect(firstPage).map((tool) => tool.name), tools.slice(0, 8).map((tool) => tool.name));
  const complete = specClientCollect(tools, { pageSize: 8 });
  assert.deepEqual(complete.map((tool) => tool.name), tools.map((tool) => tool.name));
  assert.equal(complete.length, 14);
});

test("an invalid pagination cursor is rejected as invalid params", () => {
  const tools = syntheticTools(4);
  assert.throws(() => paginateToolsList(tools, { cursor: "not-a-cursor" }), /Invalid params/);
  try {
    paginateToolsList(tools, { cursor: "not-a-cursor" });
    assert.fail("expected invalid cursor to throw");
  } catch (error) {
    assert.equal(error.code, -32602);
  }
});

test("default SDK tools/list returns every registered tool without a cursor", async () => {
  const mcp = new McpServer({ name: "complete-list", version: "0.0.0" });
  for (const tool of syntheticTools(14)) {
    mcp.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: { value: z.string() },
    }, async () => ({ content: [{ type: "text", text: "ok" }] }));
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "compat", version: "0.0.0" });
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 14);
  assert.equal(listed.nextCursor, undefined);
  await client.close();
  await mcp.close();
});

test("official SDK Client.listTools does not follow nextCursor", async () => {
  const tools = syntheticTools(14).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  const server = new Server({ name: "paginated", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async (request) => (
    paginateToolsList(tools, { pageSize: 8, cursor: request.params?.cursor })
  ));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "compat", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 8);
  assert.equal(typeof listed.nextCursor, "string");
  const second = await client.listTools({ cursor: listed.nextCursor });
  assert.equal(second.tools.length, 6);
  assert.equal(second.nextCursor, undefined);
  await client.close();
  await server.close();
});

test("server-side compact or paginated tools/list is a no-go for current clients", () => {
  const tools = syntheticTools(22);
  const firstPage = paginateToolsList(tools, { pageSize: 8 });
  const compactParsed = ListToolsResultSchema.safeParse({ tools: compactCatalog(tools) });
  const measured = measureToolsList(validListResult(tools));
  const verdict = evaluateServerSideDiscoveryChange({
    totalToolCount: measured.toolCount,
    naiveClientToolCount: naiveClientCollect(firstPage).length,
    compactPassesToolSchema: compactParsed.success,
    specHasMinimalToolsListFlag: false,
    officialSdkClientFollowsCursor: false,
    currentClientsFollowCursor: false,
  });
  assert.equal(verdict.verdict, "no-go");
  assert.equal(verdict.keepOrdinaryToolsListComplete, true);
  assert.equal(verdict.hiddenToolCount, 14);
  assert.ok(verdict.reasons.some((reason) => /hide 14 of 22/.test(reason)));
  assert.ok(verdict.reasons.some((reason) => /inputSchema/.test(reason)));
  assert.ok(measured.compactCatalogBytes < measured.resultBytes);
  assert.equal(mcpServerSource.includes("nextCursor"), false);
  assert.match(mcpServerSource, /Current MCP clients ignore pagination cursors/);
});

test("compact catalog savings are host-side only and leave payment gates off the wire copy", () => {
  const tools = syntheticTools(22, { schemaChars: 120 });
  const measured = measureToolsList(validListResult(tools));
  const compact = compactCatalog(tools, "name_title_description");
  assert.equal(compact.length, 22);
  assert.equal(compact.every((tool) => tool._meta == null && tool.inputSchema == null), true);
  assert.ok(measured.compactCatalogTokenEstimate < measured.resultTokenEstimate);
  assert.ok(measured.resultBytes > compactJsonBytes({ tools: compact }));
});
