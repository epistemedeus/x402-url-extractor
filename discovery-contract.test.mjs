import assert from "node:assert/strict";
import test from "node:test";

import { declareDiscoveryContract, getDiscoveryOutputContract } from "./discovery-contract.mjs";

test("places the authored output schema in the Bazaar v2 response contract", () => {
  const extension = declareDiscoveryContract({
    routeKey: "GET /test-contract",
    input: { url: "https://example.com" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    output: { example: { ok: true, title: "Example Domain" } },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        title: { type: "string" },
      },
      required: ["ok", "title"],
    },
  });

  const output = extension.bazaar.schema.properties.output;
  assert.deepEqual(output.properties.example.required, ["ok", "title"]);
  assert.equal(output.properties.example.properties.ok.type, "boolean");
  assert.equal(output.properties.example.properties.title.type, "string");
  assert.deepEqual(extension.bazaar.info.output.example, { ok: true, title: "Example Domain" });
  assert.equal(Object.hasOwn(extension.bazaar.info.output, "schema"), false);
  assert.deepEqual(getDiscoveryOutputContract("GET /test-contract"), {
    example: { ok: true, title: "Example Domain" },
    schema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        title: { type: "string" },
      },
      required: ["ok", "title"],
    },
  });
  assert.equal(getDiscoveryOutputContract("GET /missing"), null);
});

test("requires a unique safe route key for projected contracts", () => {
  assert.throws(() => declareDiscoveryContract({ routeKey: "PUT /bad", output: { example: {} }, outputSchema: { type: "object" } }), /Invalid discovery route key/);
  assert.throws(() => declareDiscoveryContract({ routeKey: "GET /missing-shape" }), /requires an example and output schema/);
  assert.throws(() => declareDiscoveryContract({ routeKey: "GET /test-contract", output: { example: {} }, outputSchema: { type: "object" } }), /Duplicate discovery route key/);
});

test("declares and preserves a validated POST JSON-body contract", () => {
  const extension = declareDiscoveryContract({
    routeKey: "POST /body-contract",
    method: "POST",
    bodyType: "json",
    input: { url: "https://example.com" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", format: "uri" } },
      required: ["url"],
      additionalProperties: false,
    },
    output: { example: { ok: true } },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  });

  assert.equal(extension.bazaar.info.input.method, "POST");
  assert.equal(extension.bazaar.info.input.bodyType, "json");
  assert.deepEqual(extension.bazaar.info.input.body, { url: "https://example.com" });
  assert.deepEqual(getDiscoveryOutputContract("POST /body-contract"), {
    example: { ok: true },
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  });
});

test("rejects a Bazaar contract whose output example does not satisfy its schema", () => {
  assert.throws(() => declareDiscoveryContract({
    routeKey: "GET /invalid-example",
    input: { url: "https://example.com" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    output: { example: { ok: true } },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" }, title: { type: "string" } },
      required: ["ok", "title"],
    },
  }), /Invalid Bazaar discovery contract.*title/);
  assert.equal(getDiscoveryOutputContract("GET /invalid-example"), null);
});
