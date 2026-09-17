import assert from "node:assert/strict";
import test from "node:test";

import { classifyPromptGet } from "../src/classify.mjs";
import { evaluateNegativeCase, evaluatePromptsList } from "../src/evaluate.mjs";
import { loadFixture } from "../src/paths.mjs";

test("prompts-list fixture names the three public skills and forbids paid tools", () => {
  const fixture = loadFixture("prompts-list.json");
  assert.equal(fixture.method, "prompts/list");
  assert.equal(fixture.paymentRequired, false);
  assert.equal(fixture.count, 3);
  assert.deepEqual(fixture.mustInclude, ["web-extract", "page-change", "explicit-record"]);
  assert.ok(fixture.mustExclude.includes("extract"));
  assert.ok(fixture.mustExclude.includes("__seeded_unknown_prompt__"));
});

test("evaluatePromptsList passes the unpaid catalog and fails payment challenges", () => {
  const fixture = loadFixture("prompts-list.json");
  const listed = {
    prompts: fixture.mustInclude.map((name) => ({ name, description: name })),
  };
  const ok = evaluatePromptsList(listed, fixture);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.names, fixture.mustInclude);

  const paid = evaluatePromptsList(listed, fixture, { payment: { paymentRequired: true, reason: "HTTP 402" } });
  assert.equal(paid.ok, false);
  assert.match(paid.reason, /required payment/);

  const leaked = evaluatePromptsList(
    { prompts: [...listed.prompts, { name: "extract", description: "paid tool" }] },
    fixture,
  );
  assert.equal(leaked.ok, false);
  assert.deepEqual(leaked.forbiddenPresent, ["extract"]);
});

test("evaluator refuses a fixture that expects prompts/list to be paid", () => {
  const verdict = evaluatePromptsList({ prompts: [] }, { ...loadFixture("prompts-list.json"), paymentRequired: true });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /paymentRequired false/);
});

test("negative fixture includes the seeded unknown prompt and must expect rejected", () => {
  const fixture = loadFixture("seeded-failure.json");
  assert.equal(fixture.method, "prompts/get");
  assert.equal(fixture.expect, "rejected");
  const seeded = fixture.cases.find((item) => item.seededFailure);
  assert.equal(seeded.id, "seeded-unknown-prompt");
  assert.equal(seeded.name, "__seeded_unknown_prompt__");
});

test("evaluator refuses a fixture that expects a negative prompts/get to succeed", () => {
  const verdict = evaluateNegativeCase(
    { id: "seeded-unknown-prompt", name: "__seeded_unknown_prompt__", expect: "accepted" },
    { rejected: true, layer: "mcp-protocol" },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /must expect "rejected"/);
});

test("seeded unknown prompts/get that the surface accepts is a conformance failure", () => {
  const verdict = evaluateNegativeCase(
    loadFixture("seeded-failure.json").cases[0],
    { rejected: false, layer: "accepted", message: "ok" },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.seededFailure, true);
  assert.match(verdict.reason, /must be rejected/);
});

test("seeded unknown prompts/get rejected at MCP protocol layer passes", () => {
  const error = Object.assign(new Error("MCP error -32602: Prompt __seeded_unknown_prompt__ not found"), {
    name: "McpError",
    code: -32602,
  });
  const verdict = evaluateNegativeCase(
    loadFixture("seeded-failure.json").cases[0],
    classifyPromptGet(error),
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.observation.rejected, true);
  assert.equal(verdict.observation.code, -32602);
  assert.equal(verdict.observation.layer, "mcp-protocol");
});

test("seeded unknown prompts/get that bills the caller is a conformance failure", () => {
  const verdict = evaluateNegativeCase(
    loadFixture("seeded-failure.json").cases[0],
    {
      rejected: true,
      paymentRequired: true,
      layer: "payment-required",
      code: -32042,
      message: "payment required",
    },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /not billed/);
});
