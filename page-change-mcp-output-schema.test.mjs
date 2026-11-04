import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { pageChangeRequestExample, pageChangeRequestExamples } from "./page-change-input-contract.mjs";
import { executePageChangeComparison, ownedPageChangeWorkerCount } from "./page-change-http.mjs";
import {
  PAGE_CHANGE_MCP_PATH,
  PAGE_CHANGE_MCP_TOOL,
  mountPageChangeMcp,
  pageChangeMcpToolConfig,
} from "./page-change-mcp.mjs";
import {
  pageChangeMcpOutputJsonSchema,
  pageChangeMcpOutputSchema,
} from "./page-change-mcp-output-schema.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const fx = (...parts) => path.join(cwd, "examples/customer-x402/fixtures/page-change", ...parts);
const load = async (...parts) => JSON.parse(await readFile(fx(...parts), "utf8"));
const enabledEnv = { PAGE_CHANGE_HTTP_ENABLED: "1" };
const jsonSchema = pageChangeMcpOutputJsonSchema();
const validateJsonSchema = new AjvJsonSchemaValidator().getValidator(jsonSchema);

function accept(value, label) {
  const parsed = pageChangeMcpOutputSchema.safeParse(value);
  assert.equal(parsed.success, true, `${label} zod ${parsed.success ? "" : parsed.error}`);
  const roundTrip = JSON.parse(JSON.stringify(value));
  const roundParsed = pageChangeMcpOutputSchema.safeParse(roundTrip);
  assert.equal(roundParsed.success, true, `${label} round trip ${roundParsed.success ? "" : roundParsed.error}`);
  const ajv = validateJsonSchema(roundTrip);
  assert.equal(ajv.valid, true, `${label} json schema ${ajv.errorMessage}`);
  return roundTrip;
}

function reject(value, label) {
  assert.equal(pageChangeMcpOutputSchema.safeParse(value).success, false, `${label} zod accepted a bad output`);
  const ajv = validateJsonSchema(JSON.parse(JSON.stringify(value)));
  assert.equal(ajv.valid, false, `${label} json schema accepted a bad output`);
}

async function listen(env) {
  const app = express();
  mountPageChangeMcp(app, { env });
  const server = createHttpServer(app);
  await new Promise((resolve, rejectListen) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", rejectListen);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const transport = new StreamableHTTPClientTransport(new URL(`${base}${PAGE_CHANGE_MCP_PATH}`));
  const client = new Client({ name: "page-change-output-schema", version: "0" });
  await client.connect(transport);
  return {
    base,
    client,
    async close() {
      await client.close();
      await new Promise((resolve, rejectClose) => server.close((error) => (error ? rejectClose(error) : resolve())));
    },
  };
}

async function w5(id) {
  const expected = await load("w5-corpus", "cases", id, "expected.json");
  return {
    before: await load("w5-corpus", "cases", id, "observation-before.json"),
    after: await load("w5-corpus", "cases", id, "observation-after.json"),
    fields: expected.buyer_owned_dependent_fields,
  };
}

function toolObject(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

test("success, unchanged, and edge reports match the output schema", { timeout: 120_000 }, async () => {
  const examples = pageChangeRequestExamples();
  const example = examples.titleChanged.value;
  const duplicate = await load("merchant", "duplicate-active.json");
  const missingRowAfter = structuredClone(example.after);
  missingRowAfter.sources = [];
  const pendingBefore = structuredClone(example.before);
  const pendingAfter = structuredClone(example.after);
  pendingBefore.sources[0].status = "pending";
  pendingAfter.sources[0].status = "pending";
  const addBefore = structuredClone(example.before);
  const addAfter = structuredClone(example.after);
  addBefore.sources[0].data = { title: { a: "one" } };
  addAfter.sources[0].data = { title: { a: "one", b: "two" } };
  const removeBefore = structuredClone(example.before);
  const removeAfter = structuredClone(example.after);
  removeBefore.sources[0].data = { title: { a: "one" } };
  removeAfter.sources[0].data = { title: {} };
  const reorderBefore = structuredClone(example.before);
  const reorderAfter = structuredClone(example.after);
  reorderBefore.sources[0].data = { links: ["https://a.example/1", "https://a.example/2"] };
  reorderAfter.sources[0].data = { links: ["https://a.example/2", "https://a.example/1"] };
  const longBefore = structuredClone(example.before);
  const longAfter = structuredClone(example.after);
  longBefore.sources[0].data = { title: "x".repeat(400) };
  longAfter.sources[0].data = { title: "y".repeat(400) };
  const weirdBefore = structuredClone(example.before);
  const weirdAfter = structuredClone(example.after);
  weirdBefore.jobId = 7;
  weirdBefore.jobStatus = { phase: "done" };
  weirdBefore.charged = "no";
  weirdBefore.ok = 1;
  weirdBefore.sources[0].id = 9;
  weirdBefore.sources[0].error = "plain";
  weirdBefore.sources[0].provenance = { fetchedAt: 5, requestedAt: false, completedAt: { at: "x" } };
  weirdAfter.jobId = 8;
  weirdAfter.sources[0].data.title = "other";
  weirdAfter.sources[0].error = { code: 12, extra: true };
  const fatal = {
    product: "nope",
    schemaVersion: "nope",
    sources: [{
      id: "1",
      source: "https://example.invalid/a",
      status: "success",
      data: { title: "t" },
      notes: [],
      error: null,
      provenance: {},
    }],
  };
  const manyBefore = structuredClone(example.before);
  const manyAfter = structuredClone(example.after);
  const beforeTitle = {};
  const afterTitle = {};
  for (let index = 0; index < 5; index += 1) {
    beforeTitle[`k${index}`] = "a";
    afterTitle[`k${index}`] = "b";
  }
  manyBefore.sources[0].data = { title: beforeTitle };
  manyAfter.sources[0].data = { title: afterTitle };

  const cases = [
    ["changed", await w5("case-0001-changed_selected_fields"), "changed", enabledEnv],
    ["unchanged", await w5("case-0000-unchanged_pages"), "unchanged", enabledEnv],
    ["reordered", await w5("case-0002-row_reorder"), "reordered", enabledEnv],
    ["incomplete-field", await w5("case-0004-missing_requested_field"), "incomplete", enabledEnv],
    ["failed-row", await w5("case-0005-failed_fetch"), "incomplete", enabledEnv],
    ["partial", await w5("case-0006-partial_batch"), "changed", enabledEnv],
    ["differing-fields", await w5("case-0007-differing_requested_fields"), "incomplete", enabledEnv],
    ["ambiguous", { before: duplicate, after: structuredClone(duplicate), fields: ["title"] }, "ambiguous", enabledEnv],
    ["incomparable-empty", { before: {}, after: {}, fields: ["title"] }, "incomparable", enabledEnv],
    ["public-example", pageChangeRequestExample(), "changed", enabledEnv],
    ["envelope", examples.envelope.value, "changed", enabledEnv],
    ["legacy-c1", examples.legacyC1.value, "changed", enabledEnv],
    ["missing-snapshots", { before: { missing: true }, after: { missing: true }, fields: ["title"] }, "incomparable", enabledEnv],
    ["missing-row", { before: example.before, after: missingRowAfter, fields: ["title"] }, "incomplete", enabledEnv],
    ["unknown-row", { before: pendingBefore, after: pendingAfter, fields: ["title"] }, "incomplete", enabledEnv],
    ["semantic-add", { before: addBefore, after: addAfter, fields: ["title"] }, "changed", enabledEnv],
    ["semantic-remove", { before: removeBefore, after: removeAfter, fields: ["title"] }, "changed", enabledEnv],
    ["field-reorder", { before: reorderBefore, after: reorderAfter, fields: ["links"] }, "reordered", enabledEnv],
    ["truncated-evidence", { before: longBefore, after: longAfter, fields: ["title"] }, "changed", enabledEnv],
    ["passthrough-values", { before: weirdBefore, after: weirdAfter, fields: ["title"] }, "changed", enabledEnv],
    ["fatal-artifact", { before: fatal, after: structuredClone(fatal), fields: ["title"] }, "incomparable", enabledEnv],
    ["invalid-json-body", {
      before: { mediaType: "application/json", body: "not-json{" },
      after: { mediaType: "application/json", body: example.after },
      fields: ["title"],
    }, "incomparable", enabledEnv],
    ["array-body", {
      before: { mediaType: "application/json", body: [1, 2] },
      after: { mediaType: "application/json", body: [1, 2] },
      fields: ["title"],
    }, "incomparable", enabledEnv],
    ["invalid-observed-at", {
      before: { mediaType: "application/json", observedAt: "yesterday", body: example.before },
      after: { mediaType: "application/json", observedAt: "2026-01-01T00:00:00Z", body: example.after },
      fields: ["title"],
    }, "changed", enabledEnv],
    ["inverted-observation", {
      before: { mediaType: "application/json", observedAt: "2026-02-02T00:00:00.000Z", body: examples.unchanged.value.before },
      after: { mediaType: "application/json", observedAt: "2026-01-01T00:00:00.000Z", body: examples.unchanged.value.after },
      fields: ["title"],
    }, "unchanged", enabledEnv],
    ["caller-clock-ignored", { ...examples.unchanged.value, clock: "2026-01-01T00:00:00Z", maxStaleMs: 1000 }, "unchanged", enabledEnv],
    ["max-changes", { before: manyBefore, after: manyAfter, fields: ["title"] }, "incomplete", { ...enabledEnv, PAGE_CHANGE_HTTP_MAX_CHANGES: "1" }],
  ];

  const session = await listen(enabledEnv);
  try {
    for (const [name, input, verdict, env] of cases) {
      const output = await executePageChangeComparison(input, env, { timeoutMs: 8000 });
      assert.equal(output.report.verdict, verdict, name);
      accept(output, name);
      if (name !== "max-changes") {
        const viaTool = await session.client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: input });
        assert.notEqual(viaTool.isError, true, name);
        assert.equal(viaTool.structuredContent.report.verdict, verdict, name);
        accept(viaTool.structuredContent, `${name} tool`);
        assert.deepEqual(toolObject(viaTool), JSON.parse(JSON.stringify(viaTool.structuredContent)));
      }
    }
    const limited = await listen({ ...enabledEnv, PAGE_CHANGE_HTTP_MAX_CHANGES: "1" });
    try {
      const viaTool = await limited.client.callTool({
        name: PAGE_CHANGE_MCP_TOOL,
        arguments: cases.find(([name]) => name === "max-changes")[1],
      });
      assert.notEqual(viaTool.isError, true);
      assert.equal(viaTool.structuredContent.report.verdict, "incomplete");
      assert.deepEqual(viaTool.structuredContent.report.snapshot.limitsHit, ["maxChanges"]);
      accept(viaTool.structuredContent, "max-changes tool");
    } finally {
      await limited.close();
    }
  } finally {
    await session.close();
  }
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("error paths omit structuredContent and fail the success schema", { timeout: 60_000 }, async () => {
  const session = await listen(enabledEnv);
  const disabled = await listen({});
  const oversized = await listen({ ...enabledEnv, PAGE_CHANGE_HTTP_MAX_OUTPUT_BYTES: "1" });
  const outside = await listen({
    ...enabledEnv,
    PAGE_CHANGE_HTTP_WORKER_PATH: "/tmp/n4-dm-not-a-worker.mjs",
  });
  const directory = await listen({
    ...enabledEnv,
    PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "examples"),
  });
  const previousSleep = process.env.PAGE_CHANGE_HTTP_SLEEP_MS;
  process.env.PAGE_CHANGE_HTTP_SLEEP_MS = "0";
  const hostile = await listen({
    ...enabledEnv,
    PAGE_CHANGE_HTTP_WORKER_PATH: path.join(cwd, "page-change-http-sleep-worker.mjs"),
  });
  try {
    const admitted = await session.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: {}, after: {}, fields: ["title"], clock: "yesterday" },
    });
    assert.equal(admitted.isError, true);
    assert.equal(admitted.structuredContent, undefined);
    const admittedBody = toolObject(admitted);
    assert.equal(admittedBody.code, "invalid_page_change_input");
    reject(admittedBody, "admission error");

    const fresh = await session.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: {}, after: {}, fields: ["title"], allowFreshClaim: true },
    });
    assert.equal(fresh.isError, true);
    assert.equal(fresh.structuredContent, undefined);
    assert.match(fresh.content.find((item) => item.type === "text").text, /-32602/);

    const turnedOff = await disabled.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: {}, after: {}, fields: ["title"] },
    });
    assert.equal(turnedOff.isError, true);
    assert.equal(turnedOff.structuredContent, undefined);
    const disabledBody = toolObject(turnedOff);
    assert.equal(disabledBody.error, "page_change_http_disabled");
    assert.equal(disabledBody.enabled, false);
    reject(disabledBody, "disabled");

    const tooLarge = await oversized.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: pageChangeRequestExample(),
    });
    assert.equal(tooLarge.isError, true);
    assert.equal(tooLarge.structuredContent, undefined);
    const tooLargeBody = toolObject(tooLarge);
    assert.equal(tooLargeBody.code, "output_too_large");
    reject(tooLargeBody, "output too large");

    const rejectedWorker = await outside.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: { title: "a" }, after: { title: "b" }, fields: ["title"] },
    });
    assert.equal(rejectedWorker.isError, true);
    assert.equal(rejectedWorker.structuredContent, undefined);
    const rejectedBody = toolObject(rejectedWorker);
    assert.equal(rejectedBody.code, "invalid_worker_path");
    reject(rejectedBody, "invalid worker");

    const workerFailed = await directory.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: { title: "a" }, after: { title: "b" }, fields: ["title"] },
    });
    assert.equal(workerFailed.isError, true);
    assert.equal(workerFailed.structuredContent, undefined);
    const workerFailedBody = toolObject(workerFailed);
    assert.equal(workerFailedBody.code, "compare_failed");
    reject(workerFailedBody, "compare failed");

    const brokenEnv = { ...enabledEnv };
    const broken = await listen(brokenEnv);
    try {
      brokenEnv.PAGE_CHANGE_HTTP_MAX_BYTES = "0";
      const generic = await broken.client.callTool({
        name: PAGE_CHANGE_MCP_TOOL,
        arguments: { before: { title: "a" }, after: { title: "b" }, fields: ["title"] },
      });
      assert.equal(generic.isError, true);
      assert.equal(generic.structuredContent, undefined);
      const genericBody = toolObject(generic);
      assert.equal(genericBody.code, "page_change_http_failed");
      assert.equal(genericBody.error, "page_change_http_failed");
      reject(genericBody, "generic failure");
    } finally {
      await broken.close();
    }

    const slept = await hostile.client.callTool({
      name: PAGE_CHANGE_MCP_TOOL,
      arguments: { before: { title: "a" }, after: { title: "b" }, fields: ["title"] },
    });
    assert.equal(slept.isError, true);
    assert.equal(slept.structuredContent, undefined);
    const sleptBody = toolObject(slept);
    assert.equal(sleptBody.code, "sleep_elapsed");
    reject(sleptBody, "worker failure");

    let deep = { leaf: true };
    for (let index = 0; index < 20; index += 1) deep = { nested: deep };
    const depth = await fetch(`${session.base}${PAGE_CHANGE_MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: PAGE_CHANGE_MCP_TOOL, arguments: { before: deep, after: { title: "a" }, fields: ["title"] } },
      }),
    });
    const depthBody = await depth.json();
    assert.equal(depth.status, 400);
    assert.equal(depthBody.code, "json_depth_limit");
    assert.equal(depthBody.structuredContent, undefined);
    reject(depthBody, "depth limit");
  } finally {
    if (previousSleep === undefined) delete process.env.PAGE_CHANGE_HTTP_SLEEP_MS;
    else process.env.PAGE_CHANGE_HTTP_SLEEP_MS = previousSleep;
    await hostile.close();
    await directory.close();
    await outside.close();
    await oversized.close();
    await disabled.close();
    await session.close();
  }
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("a mutated success output fails validation and SDK enforcement", async () => {
  const good = await executePageChangeComparison(pageChangeRequestExample(), enabledEnv, { timeoutMs: 8000 });
  accept(good, "baseline");
  const mutated = structuredClone(good);
  mutated.report.verdict = "nope";
  mutated.extra = true;
  reject(mutated, "mutated verdict");
  const missingReport = structuredClone(good);
  delete missingReport.report;
  reject(missingReport, "missing report");
  const charged = structuredClone(good);
  charged.charged = true;
  reject(charged, "charged true");

  const server = new McpServer({ name: "page-change-schema", version: "test" });
  server.registerTool(PAGE_CHANGE_MCP_TOOL, pageChangeMcpToolConfig(), async () => ({
    content: [{ type: "text", text: JSON.stringify(mutated) }],
    structuredContent: mutated,
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "page-change-schema", version: "0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.find((tool) => tool.name === PAGE_CHANGE_MCP_TOOL).outputSchema, jsonSchema);
    const result = await client.callTool({ name: PAGE_CHANGE_MCP_TOOL, arguments: pageChangeRequestExample() });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.match(result.content[0].text, /Output validation error/);
  } finally {
    await client.close();
  }
  assert.equal(ownedPageChangeWorkerCount(), 0);
});

test("tools/list advertises the schema on HTTP and stdio", { timeout: 30_000 }, async () => {
  const http = await listen(enabledEnv);
  let stdioClient;
  try {
    const listed = await http.client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [PAGE_CHANGE_MCP_TOOL]);
    const tool = listed.tools[0];
    assert.equal(tool.description, pageChangeMcpToolConfig().description);
    assert.deepEqual(tool.outputSchema, jsonSchema);
    assert.equal(tool.outputSchema.type, "object");
    assert.equal(tool.outputSchema.additionalProperties, false);
    for (const key of ["ok", "product", "schemaVersion", "charged", "report"]) {
      assert.equal(tool.outputSchema.required.includes(key), true, key);
    }
    assert.equal(tool.outputSchema.properties.ok.const, true);
    assert.equal(tool.outputSchema.properties.charged.const, false);
    assert.equal(tool.outputSchema.properties.product.const, "samedaydesk-page-change-http");
    assert.deepEqual(tool.outputSchema.properties.report.properties.verdict.enum, [
      "changed", "unchanged", "reordered", "incomplete", "ambiguous", "incomparable",
    ]);

    const raw = await fetch(`${http.base}${PAGE_CHANGE_MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const rawText = await raw.text();
    assert.equal(raw.status, 200);
    assert.match(rawText, /"outputSchema"/);
    assert.match(rawText, /samedaydesk-page-change-http/);

    stdioClient = new Client({ name: "page-change-stdio", version: "0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(cwd, "page-change-mcp-stdio-probe.mjs")],
      cwd,
      env: { ...process.env, PAGE_CHANGE_HTTP_ENABLED: "1" },
      stderr: "pipe",
    });
    await stdioClient.connect(transport);
    const stdioListed = await stdioClient.listTools();
    assert.deepEqual(stdioListed.tools.map((entry) => entry.name), [PAGE_CHANGE_MCP_TOOL]);
    assert.deepEqual(stdioListed.tools[0].outputSchema, tool.outputSchema);
    assert.equal(stdioListed.tools[0].description, tool.description);
  } finally {
    await stdioClient?.close();
    await http.close();
  }
});
