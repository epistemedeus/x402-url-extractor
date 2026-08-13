import assert from "node:assert/strict";
import test from "node:test";

import {
  declareDiscoveryContract,
  getDiscoveryOutputContract,
  getDiscoveryRequestContract,
  projectDiscoveryRequest,
} from "./discovery-contract.mjs";

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
  const request = getDiscoveryRequestContract("GET /test-contract");
  assert.deepEqual(request.example, { type: "http", method: "GET", queryParams: { url: "https://example.com" } });
  assert.ok(request.schema.properties.method.enum.includes("GET"));
  assert.deepEqual(request.schema.properties.queryParams.required, ["url"]);
  assert.deepEqual(projectDiscoveryRequest("https://agents.example/extract", "GET", request), {
    method: "GET",
    url: "https://agents.example/extract",
    example: request.example,
    schema: request.schema,
    exampleUrl: "https://agents.example/extract?url=https%3A%2F%2Fexample.com",
  });
  assert.equal(getDiscoveryOutputContract("GET /missing"), null);
  assert.equal(getDiscoveryRequestContract("GET /missing"), null);
});

test("projects only credential-free HTTPS examples with scalar query values", () => {
  const contract = {
    example: { type: "http", method: "GET", queryParams: { second: 2, first: true } },
    schema: { type: "object" },
  };
  assert.equal(
    projectDiscoveryRequest("https://agents.example/route", "GET", contract).exampleUrl,
    "https://agents.example/route?first=true&second=2",
  );
  assert.throws(() => projectDiscoveryRequest("http://agents.example/route", "GET", contract), /credential-free HTTPS/);
  assert.throws(() => projectDiscoveryRequest("https://agents.example/route", "GET", { ...contract, example: { queryParams: { nested: {} } } }), /non-scalar/);
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
  assert.deepEqual(getDiscoveryRequestContract("POST /body-contract").example, {
    type: "http",
    method: "POST",
    bodyType: "json",
    body: { url: "https://example.com" },
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
