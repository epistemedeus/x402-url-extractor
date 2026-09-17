import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { UNPAID_PROMPT_DISCOVERY_NOTE } from "../src/catalog.mjs";
import { registerUnpaidPrompts } from "../src/register.mjs";

test("registerUnpaidPrompts advertises the catalog on a bare MCP server", async () => {
  const server = new McpServer({ name: "prompts-list-unpaid-unit", version: "0.1.0" });
  const summaries = registerUnpaidPrompts(server);
  assert.deepEqual(summaries.map((item) => item.name), ["web-extract", "page-change", "explicit-record"]);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "unit", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listPrompts();
    assert.deepEqual(listed.prompts.map((prompt) => prompt.name), summaries.map((item) => item.name));
    const got = await client.getPrompt({ name: "web-extract" });
    assert.equal(got.messages[0].role, "user");
    assert.equal(got.messages[0].content.text.includes(UNPAID_PROMPT_DISCOVERY_NOTE), true);
    assert.match(got.messages[0].content.text, /name: web-extract/);
  } finally {
    await client.close();
    await server.close();
  }
});
