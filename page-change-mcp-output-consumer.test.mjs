// Ordinary consumer of compare_page_observations outputSchema.
// SDK Client 1.30 validates structuredContent after listTools caches the
// tools/list schema. If a future client returns tampered structuredContent,
// this test records that and rejects it with Ajv instead.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { pageChangeRequestExample, pageChangeMcpDescription } from "./page-change-input-contract.mjs";
import { ownedPageChangeWorkerCount } from "./page-change-http.mjs";
import {
  PAGE_CHANGE_MCP_PATH,
  PAGE_CHANGE_MCP_TOOL,
  mountPageChangeMcp,
} from "./page-change-mcp.mjs";
import { pageChangeMcpOutputJsonSchema } from "./page-change-mcp-output-schema.mjs";
import {
  FREE_PAGE_COMPARE_OUTPUT_CONTRACT,
  freePageCompareAgentSkill,
  renderFreePageCompareLlmsSection,
  renderFreePageCompareSkillAppendix,
} from "./page-change-free-surface.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const sdkVersion = JSON.parse(readFileSync(path.join(cwd, "node_modules/@modelcontextprotocol/sdk/package.json"), "utf8")).version;
const jsonSchema = pageChangeMcpOutputJsonSchema();
const validate = new AjvJsonSchemaValidator().getValidator(jsonSchema);
const origin = "https://agents.example";

function listen(app) {
  const server = createHttpServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
    server.once("error", reject);
  });
}

async function connect(base) {
  const client = new Client({ name: "page-change-output-consumer", version: sdkVersion });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}${PAGE_CHANGE_MCP_PATH}`));
  await client.connect(transport);
  return client;
}

function tamperedApp(structuredContent) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.post(PAGE_CHANGE_MCP_PATH, async (req, res) => {
    const server = new Server(
      { name: "page-change-tampered", version: "0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: PAGE_CHANGE_MCP_TOOL,
        description: "tampered output fixture",
        inputSchema: { type: "object", additionalProperties: true },
        outputSchema: jsonSchema,
      }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return app;
}

test("free surfaces carry the output contract and the tool contract stays put", () => {
  assert.match(renderFreePageCompareLlmsSection(origin), new RegExp(FREE_PAGE_COMPARE_OUTPUT_CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(renderFreePageCompareSkillAppendix(origin), new RegExp(FREE_PAGE_COMPARE_OUTPUT_CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const skill = freePageCompareAgentSkill(origin);
  assert.match(skill.description, /Success structuredContent validates against the outputSchema on tools\/list/);
  assert.match(skill.description, /isError results carry none/);
  const example = JSON.parse(skill.description.slice(skill.description.indexOf("Input example: ") + "Input example: ".length));
  assert.equal(example.before.sources[0].source, "https://synthetic.example.invalid/page");
  assert.equal(pageChangeMcpDescription().includes(FREE_PAGE_COMPARE_OUTPUT_CONTRACT), false);
  assert.equal(pageChangeMcpDescription().includes("outputSchema"), false);
  for (const file of ["server.json", "registry/page-change/server.json"]) {
    assert.equal(readFileSync(path.join(cwd, file), "utf8").includes(FREE_PAGE_COMPARE_OUTPUT_CONTRACT), false, file);
  }
  const pluginSkill = readFileSync(path.join(cwd, "plugins/samedaydesk-page-compare/skills/compare-held-pages/SKILL.md"), "utf8");
  const readme = readFileSync(path.join(cwd, "plugins/samedaydesk-page-compare/README.md"), "utf8");
  const machine = readme.slice(readme.indexOf("## Machine use"), readme.indexOf("## What this draft validates"));
  for (const text of [pluginSkill, machine]) {
    const listed = text.indexOf("listTools");
    const called = text.indexOf("callTool");
    const rely = text.toLowerCase().indexOf("schema validation");
    assert.equal(listed >= 0 && listed < called && called < rely, true);
    assert.match(text, /structuredContent/);
    assert.match(text, /isError/);
  }
});

test("SDK client accepts a mounted result and rejects tampered structuredContent", { timeout: 30_000 }, async () => {
  const app = express();
  mountPageChangeMcp(app, { env: { PAGE_CHANGE_HTTP_ENABLED: "1" } });
  const mounted = await listen(app);
  const client = await connect(mounted.base);
  let tamperedHttp;
  let tamperedClient;
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find((entry) => entry.name === PAGE_CHANGE_MCP_TOOL);
    assert.deepEqual(tool.outputSchema, jsonSchema);
    const result = await client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: pageChangeRequestExample(),
    });
    assert.notEqual(result.isError, true);
    assert.equal(validate(result.structuredContent).valid, true);
    assert.equal(result.structuredContent.charged, false);

    const errorResult = await client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: {}, after: {}, fields: ["title"], allowFreshClaim: true },
    });
    assert.equal(errorResult.isError, true);
    assert.equal(errorResult.structuredContent, undefined);

    const tampered = structuredClone(result.structuredContent);
    tampered.report.verdict = "nope";
    tampered.extra = true;
    assert.equal(validate(tampered).valid, false);
    tamperedHttp = await listen(tamperedApp(tampered));
    tamperedClient = await connect(tamperedHttp.base);
    await tamperedClient.listTools();
    let rejected = false;
    let returned = null;
    try {
      returned = await tamperedClient.callTool({
        name: PAGE_CHANGE_MCP_TOOL,
        arguments: pageChangeRequestExample(),
      });
    } catch (error) {
      rejected = true;
      assert.equal(error instanceof McpError, true);
      assert.match(error.message, /does not match the tool's output schema/);
    }
    if (rejected) {
      assert.equal(rejected, true, `@modelcontextprotocol/sdk ${sdkVersion} validates listed outputSchema`);
    } else {
      // Recorded fallback: this client returned tampered structuredContent.
      assert.equal(returned.structuredContent.report.verdict, "nope");
      assert.equal(validate(returned.structuredContent).valid, false, `recorded: @modelcontextprotocol/sdk ${sdkVersion} did not validate; Ajv rejected the tampered structuredContent`);
    }
  } finally {
    await tamperedClient?.close().catch(() => {});
    await tamperedHttp?.close();
    await client.close();
    await mounted.close();
  }
  assert.equal(ownedPageChangeWorkerCount(), 0);
});
