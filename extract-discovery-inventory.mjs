/** Test support for unpaid discovery, not a runtime router or payment client. */
import assert from "node:assert/strict";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { extractMcpOutputSchema } from "./extract.mjs";
import { extractBatchInputSchema, extractBatchMcpOutputSchema } from "./extract-batch.mjs";

// Compare contract keywords exactly, ignoring only descriptive annotations and
// the SDK's draft marker. Do not implement another partial JSON Schema parser.
function contract(schema) {
  if (Array.isArray(schema)) return schema.map(contract);
  if (schema && typeof schema === "object") {
    return Object.fromEntries(Object.entries(schema)
      .filter(([key]) => key !== "description" && key !== "$schema")
      .map(([key, value]) => [key,
        ["properties", "patternProperties", "$defs", "definitions"].includes(key)
          ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, contract(child)]))
          : contract(value)]));
  }
  return schema;
}

export function assertExtractDiscoveryInventory(tools) {
  assert.ok(Array.isArray(tools), "tools/list must return an array");
  const batchInput = extractBatchInputSchema();
  // The mounted MCP Zod array advertises bounds/enum; uniqueness is enforced by
  // normalizeExtractBatchInput at the HTTP boundary, not by MCP JSON Schema.
  delete batchInput.properties.fields.uniqueItems;
  const expected = {
    extract: {
      inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
      outputSchema: toJsonSchemaCompat(extractMcpOutputSchema, { strictUnions: true, pipeStrategy: "output" }),
    },
    extract_batch: {
      inputSchema: batchInput,
      outputSchema: toJsonSchemaCompat(extractBatchMcpOutputSchema, { strictUnions: true, pipeStrategy: "output" }),
    },
  };
  const found = {};
  for (const [name, schemas] of Object.entries(expected)) {
    const matches = tools.filter((tool) => tool?.name === name);
    assert.equal(matches.length, 1, `tools/list missing or duplicate ${name}`);
    const tool = matches[0];
    for (const [key, schema] of Object.entries(schemas)) {
      assert.deepEqual(contract(tool[key]), contract(schema), `${name} ${key} contract drift`);
    }
    found[name] = tool;
  }
  return { extract: found.extract, batch: found.extract_batch, names: tools.map((tool) => tool?.name) };
}
