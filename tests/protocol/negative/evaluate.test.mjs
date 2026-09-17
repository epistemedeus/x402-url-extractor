import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { classifyJsonRpcResponse, classifyRejectFixture, classifyToolsCall } from "./classify.mjs";
import { evaluateNegativeCase, evaluateNegativeSuite, evaluateToolsList } from "./evaluate.mjs";
import { FIXTURE_SCHEMA, FIXTURES_DIR, loadFixture, loadManifest, loadRejectFixtures } from "./paths.mjs";

test("tools-list fixture names extract and forbids the seeded unknown tool", () => {
  const fixture = loadFixture("tools-list.json");
  assert.equal(fixture.method, "tools/list");
  assert.equal(fixture.count, 1);
  assert.ok(fixture.mustInclude.includes("extract"));
  assert.ok(fixture.mustExclude.includes("__seeded_unknown_tool__"));
});

test("evaluateToolsList passes the catalog and fails unknown-tool leakage", () => {
  const fixture = loadFixture("tools-list.json");
  const listed = {
    tools: fixture.mustInclude.map((name) => ({
      name,
      inputSchema: { type: "object" },
    })),
  };
  const ok = evaluateToolsList(listed, fixture);
  assert.equal(ok.ok, true);

  const leaked = evaluateToolsList(
    { tools: [...listed.tools, { name: "__seeded_unknown_tool__", inputSchema: { type: "object" } }] },
    fixture,
  );
  assert.equal(leaked.ok, false);
  assert.deepEqual(leaked.forbiddenPresent, ["__seeded_unknown_tool__"]);
});

test("negative-tools-call fixture is must-reject and includes the seeded unknown tool", () => {
  const fixture = loadFixture("negative-tools-call.json");
  assert.equal(fixture.method, "tools/call");
  assert.equal(fixture.expect, "rejected");
  const seeded = fixture.cases.find((item) => item.seededFailure);
  assert.equal(seeded.id, "seeded-unknown-tool");
  assert.equal(seeded.name, "__seeded_unknown_tool__");
  assert.equal(seeded.expectedCode, -32602);
  assert.equal(JSON.parse(readFileSync(join(FIXTURES_DIR, "negative-tools-call.json"), "utf8")).expect, "rejected");
});

test("evaluator refuses a fixture that expects a negative tools/call to succeed", () => {
  const verdict = evaluateNegativeCase(
    { id: "seeded-unknown-tool", name: "__seeded_unknown_tool__", expect: "accepted" },
    { rejected: true, layer: "mcp-protocol" },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /must expect "rejected"/);
});

test("seeded unknown tools/call that the surface accepts is a conformance failure", () => {
  const verdict = evaluateNegativeCase(
    {
      id: "seeded-unknown-tool",
      name: "__seeded_unknown_tool__",
      seededFailure: true,
      reason: "unknown tool must be rejected at MCP tools/call",
    },
    { rejected: false, layer: "accepted", message: "ok" },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.seededFailure, true);
  assert.match(verdict.reason, /must be rejected/);
});

test("seeded unknown tools/call rejected at MCP protocol layer passes", () => {
  const verdict = evaluateNegativeCase(
    loadFixture("negative-tools-call.json").cases[0],
    classifyToolsCall(Object.assign(new Error("MCP error -32602: Tool __seeded_unknown_tool__ not found"), {
      name: "McpError",
      code: -32602,
    })),
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.observation.rejected, true);
  assert.equal(verdict.observation.layer, "mcp-protocol");
  assert.equal(verdict.observation.code, -32602);
});

test("payment-required on an unknown-tool fixture is a conformance failure", () => {
  const verdict = evaluateNegativeCase(
    loadFixture("negative-tools-call.json").cases[0],
    {
      rejected: true,
      layer: "x402-payment-required",
      code: -32042,
      message: "Payment required to access this tool",
    },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /expected layer mcp-protocol/);
});

test("handler execution on a mustNotRunHandler case fails the fixture", () => {
  const verdict = evaluateNegativeCase(
    loadFixture("negative-tools-call.json").cases[0],
    { rejected: true, layer: "mcp-protocol", code: -32602, message: "not found" },
    { handler: 1, verify: 0, settle: 0 },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /ran the paid handler/);
});

test("evaluateNegativeSuite fails closed when expect is not rejected", () => {
  const suite = evaluateNegativeSuite({ expect: "accepted", cases: [] }, {});
  assert.equal(suite.ok, false);
  assert.match(suite.reason, /expect: "rejected"/);
});

test("classifyToolsCall unwraps SDK-wrapped MCP error -32602 as protocol rejection", () => {
  const classified = classifyToolsCall({
    isError: true,
    content: [{ type: "text", text: "MCP error -32602: Tool __seeded_unknown_tool__ not found" }],
  });
  assert.equal(classified.rejected, true);
  assert.equal(classified.layer, "mcp-protocol");
  assert.equal(classified.code, -32602);
  assert.match(classified.message, /__seeded_unknown_tool__/);
});

test("classifyToolsCall treats unpaid PaymentRequired isError as x402-payment-required", () => {
  const classified = classifyToolsCall({
    isError: true,
    structuredContent: {
      x402Version: 2,
      error: "Payment required to access this tool",
      accepts: [{ scheme: "exact" }],
    },
  });
  assert.equal(classified.rejected, true);
  assert.equal(classified.layer, "x402-payment-required");
  assert.equal(classified.code, -32042);
});

test("manifest lists every reject fixture and they classify as accepted product bodies", () => {
  const manifest = loadManifest();
  assert.equal(manifest.schema, FIXTURE_SCHEMA);
  const listed = manifest.fixtures.filter((entry) => entry.expect === "reject").map((entry) => entry.path).sort();
  const onDisk = loadRejectFixtures().map((entry) => entry.relativePath).sort();
  assert.deepEqual(listed, onDisk);
  assert.ok(onDisk.length >= 2);
  for (const entry of loadRejectFixtures()) {
    const classified = classifyRejectFixture(entry.fixture);
    assert.equal(classified.ok, true, entry.id);
    assert.equal(classified.verdict, "accepted");
    assert.equal(classified.observation.rejected, false);
  }
});

test("accepted-unknown-tool wire fixture is not a protocol rejection", () => {
  const fixture = loadFixture("reject/accepted-unknown-tool.json");
  const classified = classifyJsonRpcResponse(fixture.response);
  assert.equal(classified.rejected, false);
  assert.equal(classified.layer, "accepted");
  assert.match(classified.message, /__seeded_unknown_tool__/);
});
