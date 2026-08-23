import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDiscoveryRequestConstruction,
  declareDiscoveryContract,
  getDiscoveryOutputContract,
  getDiscoveryRequestContract,
  projectDiscoveryRequest,
  withReplacementDiscoveryRegistry,
} from "./discovery-contract.mjs";
import * as discoveryContract from "./discovery-contract.mjs";

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
  assert.deepEqual(classifyDiscoveryRequestConstruction("GET /test-contract", ["url"]), {
    status: "constructed",
    requiredKeyCount: 1,
  });
  assert.deepEqual(classifyDiscoveryRequestConstruction("GET /test-contract", []), {
    status: "missing_required_input",
    requiredKeyCount: 1,
  });
  assert.deepEqual(classifyDiscoveryRequestConstruction("GET /test-contract", { url: "  " }), {
    status: "missing_required_input",
    requiredKeyCount: 1,
  });
  assert.deepEqual(classifyDiscoveryRequestConstruction("GET /test-contract", { url: ["", "https://example.com"] }), {
    status: "constructed",
    requiredKeyCount: 1,
  });
  assert.deepEqual(classifyDiscoveryRequestConstruction("GET /missing", ["url"]), {
    status: "undeclared",
    requiredKeyCount: 0,
  });
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
  const again = declareDiscoveryContract({
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
  assert.equal(again.bazaar.info.output.example.title, "Example Domain");
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
  assert.deepEqual(classifyDiscoveryRequestConstruction("POST /body-contract", ["url"]), {
    status: "not_measured",
    requiredKeyCount: 0,
  });
});

test("does not measure credential-like required keys", () => {
  declareDiscoveryContract({
    routeKey: "GET /sensitive-contract",
    input: { api_token: "not-a-real-secret" },
    inputSchema: {
      type: "object",
      properties: { api_token: { type: "string" } },
      required: ["api_token"],
    },
    output: { example: { ok: true } },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  });
  assert.deepEqual(classifyDiscoveryRequestConstruction("GET /sensitive-contract", ["api_token"]), {
    status: "not_measured",
    requiredKeyCount: 0,
  });
  declareDiscoveryContract({
    routeKey: "GET /camel-sensitive-contract",
    input: { accessToken: "not-a-real-secret" },
    inputSchema: {
      type: "object",
      properties: { accessToken: { type: "string" } },
      required: ["accessToken"],
    },
    output: { example: { ok: true } },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  });
  assert.deepEqual(classifyDiscoveryRequestConstruction("GET /camel-sensitive-contract", ["accessToken"]), {
    status: "not_measured",
    requiredKeyCount: 0,
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

const REVIEW_PROBE_OUTPUT = {
  example: { ok: true, title: "Review Probe" },
  schema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      title: { type: "string" },
    },
    required: ["ok", "title"],
  },
};

test("rejects the same route with a different request contract and leaves both maps unchanged", () => {
  declareDiscoveryContract({
    routeKey: "GET /review-probe",
    input: { url: "https://first.example" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    output: { example: REVIEW_PROBE_OUTPUT.example },
    outputSchema: REVIEW_PROBE_OUTPUT.schema,
  });
  const beforeRequest = getDiscoveryRequestContract("GET /review-probe");
  const beforeOutput = getDiscoveryOutputContract("GET /review-probe");
  assert.deepEqual(beforeRequest.example.queryParams, { url: "https://first.example" });
  assert.deepEqual(beforeRequest.schema.properties.queryParams.required, ["url"]);
  assert.throws(() => declareDiscoveryContract({
    routeKey: "GET /review-probe",
    input: { domain: "second.example" },
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"],
    },
    output: { example: REVIEW_PROBE_OUTPUT.example },
    outputSchema: REVIEW_PROBE_OUTPUT.schema,
  }), /Duplicate discovery route key/);
  assert.deepEqual(getDiscoveryRequestContract("GET /review-probe"), beforeRequest);
  assert.deepEqual(getDiscoveryOutputContract("GET /review-probe"), beforeOutput);
  assert.deepEqual(getDiscoveryRequestContract("GET /review-probe").schema.properties.queryParams.required, ["url"]);
  assert.equal(Object.hasOwn(getDiscoveryRequestContract("GET /review-probe").example.queryParams, "domain"), false);
});

test("rejects the same route with a different output contract and leaves both maps unchanged", () => {
  const beforeRequest = getDiscoveryRequestContract("GET /review-probe");
  const beforeOutput = getDiscoveryOutputContract("GET /review-probe");
  assert.throws(() => declareDiscoveryContract({
    routeKey: "GET /review-probe",
    input: { url: "https://first.example" },
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    output: { example: { ok: true, title: "Changed" } },
    outputSchema: REVIEW_PROBE_OUTPUT.schema,
  }), /Duplicate discovery route key/);
  assert.deepEqual(getDiscoveryRequestContract("GET /review-probe"), beforeRequest);
  assert.deepEqual(getDiscoveryOutputContract("GET /review-probe"), beforeOutput);
});

test("invalid re-declaration of an existing route does not delete the original contracts", () => {
  const beforeRequest = getDiscoveryRequestContract("GET /test-contract");
  const beforeOutput = getDiscoveryOutputContract("GET /test-contract");
  assert.ok(beforeRequest);
  assert.ok(beforeOutput);
  assert.throws(() => declareDiscoveryContract({
    routeKey: "GET /test-contract",
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
  }), /Invalid Bazaar discovery contract/);
  assert.deepEqual(getDiscoveryRequestContract("GET /test-contract"), beforeRequest);
  assert.deepEqual(getDiscoveryOutputContract("GET /test-contract"), beforeOutput);
});

test("does not export a process-global registry eraser", () => {
  assert.equal(Object.hasOwn(discoveryContract, "resetDiscoveryContracts"), false);
  assert.equal(typeof discoveryContract.resetDiscoveryContracts, "undefined");
});

test("a failed replacement transaction discards the partial staging registry", () => {
  const beforeRequest = getDiscoveryRequestContract("GET /test-contract");
  const beforeProbe = getDiscoveryRequestContract("GET /review-probe");
  assert.throws(() => withReplacementDiscoveryRegistry(() => {
    declareDiscoveryContract({
      routeKey: "GET /partial-only",
      input: { url: "https://partial.example" },
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      output: { example: { ok: true } },
      outputSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    });
    assert.equal(getDiscoveryRequestContract("GET /partial-only") !== null, true);
    assert.equal(getDiscoveryRequestContract("GET /test-contract"), null);
    throw new Error("factory_failed");
  }), /factory_failed/);
  assert.equal(getDiscoveryRequestContract("GET /partial-only"), null);
  assert.deepEqual(getDiscoveryRequestContract("GET /test-contract"), beforeRequest);
  assert.deepEqual(getDiscoveryRequestContract("GET /review-probe"), beforeProbe);
});

test("refuses to commit an empty replacement registry", () => {
  const beforeRequest = getDiscoveryRequestContract("GET /test-contract");
  assert.throws(() => withReplacementDiscoveryRegistry(() => undefined), /empty discovery registry/);
  assert.deepEqual(getDiscoveryRequestContract("GET /test-contract"), beforeRequest);
});
