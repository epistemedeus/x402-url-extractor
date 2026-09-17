import assert from "node:assert/strict";
import { test } from "node:test";

import { loadFixture } from "./paths.mjs";
import { runConformance, runSeededFailure } from "./run.mjs";

test(
  "official SDK client rejects every negative tools/call fixture, including the seeded unknown tool",
  { timeout: 60_000 },
  async () => {
    const fixture = loadFixture("negative-tools-call.json");
    const report = await runConformance();
    assert.equal(report.status, "pass", report.negativeToolsCall?.reason);
    assert.equal(report.toolsList.ok, true, report.toolsList?.reason);
    assert.equal(report.toolsList.count, 1);
    assert.deepEqual(report.toolsList.names, ["extract"]);
    assert.equal(report.toolsList.forbiddenPresent.length, 0);
    assert.equal(report.negativeToolsCall.total, fixture.cases.length);
    assert.equal(report.negativeToolsCall.passed, fixture.cases.length);
    assert.equal(report.negativeToolsCall.seededFailure.rejected, true);
    assert.equal(report.negativeToolsCall.seededFailure.id, "seeded-unknown-tool");
    assert.equal(report.negativeToolsCall.seededFailure.layer, "mcp-protocol");
    assert.equal(report.negativeToolsCall.seededFailure.code, -32602);
    for (const item of report.negativeToolsCall.cases) {
      assert.equal(item.ok, true, item.reason);
      assert.equal(item.observation.rejected, true, item.id);
    }
    assert.equal(report.counters.handler, 0);
    assert.equal(report.counters.verify, 0);
    assert.equal(report.counters.settle, 0);
  },
);

test(
  "seeded failure __seeded_unknown_tool__ is rejected through the real client and on the wire",
  { timeout: 60_000 },
  async () => {
    const report = await runSeededFailure();
    assert.equal(report.status, "pass", report.seededFailure?.reason);
    assert.equal(report.seededFailure.rejected, true);
    assert.equal(report.seededFailure.id, "seeded-unknown-tool");
    assert.equal(report.seededFailure.name, "__seeded_unknown_tool__");
    assert.equal(report.seededFailure.layer, "mcp-protocol");
    assert.equal(report.seededFailure.code, -32602);
    assert.match(String(report.seededFailure.message), /__seeded_unknown_tool__/);
    assert.match(String(report.seededFailure.wire.resultText), /MCP error -32602: Tool __seeded_unknown_tool__ not found/);
    assert.equal(report.seededFailure.wire.httpStatus, 200);
    assert.equal(report.seededFailure.wire.observation.code, -32602);
    assert.equal(report.seededFailure.counters.total.handler, 0);
    assert.equal(report.seededFailure.counters.total.settle, 0);
    assert.equal(report.seededFailure.counters.total.verify, 0);
  },
);
