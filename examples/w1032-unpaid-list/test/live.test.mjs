import assert from "node:assert/strict";
import test from "node:test";

import { LIVE_MCP_URL } from "../src/constants.mjs";
import { unpaidToolsList } from "../src/list.mjs";
import { parseJsonStdout, runCli } from "./helpers.mjs";

test("live unpaid initialize and tools/list require extract and extract_batch", { timeout: 30_000 }, async () => {
  const listed = await unpaidToolsList({ url: LIVE_MCP_URL });
  assert.equal(listed.ok, true);
  assert.equal(listed.mcpUrl, LIVE_MCP_URL);
  assert.equal(listed.transport, "streamable-http");
  assert.equal(listed.protocolVersion, "2025-11-25");
  assert.equal(listed.serverInfo.name, "x402-data-gateway");
  assert.ok(listed.names.includes("extract"));
  assert.ok(listed.names.includes("extract_batch"));
  assert.equal(listed.boundary.paymentSent, false);
  assert.equal(listed.boundary.toolsCalled, false);
  assert.equal(listed.boundary.published, false);
  assert.equal(listed.boundary.neoUsed, false);
  assert.deepEqual(listed.boundary.methods, ["initialize", "tools/list"]);
  assert.ok(listed.toolCount >= 2);
});

test("CLI cold live list exits 0", { timeout: 30_000 }, async () => {
  const ran = await runCli(["--json"], { timeoutMs: 25_000 });
  assert.equal(ran.code, 0, ran.stderr);
  const report = parseJsonStdout(ran.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.mcpUrl, LIVE_MCP_URL);
  assert.ok(report.names.includes("extract"));
  assert.ok(report.names.includes("extract_batch"));
  assert.equal(report.boundary.toolsCalled, false);
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.command, "list");
});
