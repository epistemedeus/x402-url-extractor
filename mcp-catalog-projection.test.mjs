import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_RECOVERY_TOOL,
  assertPreparedMatchesProjection,
  assertSameMcpProjection,
  compareMcpCatalog,
  describeMcpCatalog,
  historicalMcpDescriptorView,
  mcpCatalogCacheControl,
  projectMcpInventory,
} from "./mcp-catalog-projection.mjs";

const schema = { type: "object" };
const FREE_ONLY = "compare_page_observations";

function tool(name, { free = false, outputSchema } = {}) {
  return { name, free, outputSchema, description: name };
}

function detailFor(name) {
  if (name === "page_change") return { name, method: "POST", route: "/recipes/page-change", charged: false };
  if (name === "careers_board_cold") return { name, method: "GET", route: "/recipes/careers-board-cold", charged: false };
  if (name === "report_caller_result") return { name, charged: false, channel: "mcp", optional: true };
  if (name === "trial_read") return { name, charged: false, paymentRequired: false, consumesSharedTrialAllowance: true };
  if (name === MCP_RECOVERY_TOOL) return { name, charged: false, paymentRequired: false, channel: "mcp" };
  return { name, charged: false };
}

function configuredTools({ extractBatch = false, lockfile = false, pageChange = false } = {}) {
  return [
    ...(pageChange ? [tool("page_change", { free: true })] : []),
    tool("careers_board_cold", { free: true }),
    tool("report_caller_result", { free: true }),
    tool("trial_read", { free: true, outputSchema: schema }),
    tool("careers_board"),
    tool("extract", { outputSchema: schema }),
    ...(extractBatch ? [tool("extract_batch", { outputSchema: schema })] : []),
    ...(lockfile ? [tool("lockfile_pin_delta", { outputSchema: schema })] : []),
    tool("read", { outputSchema: schema }),
  ];
}

function listedFrom(projection) {
  return projection.tools.map((row) => ({
    name: row.name,
    outputSchema: row.outputSchema ? schema : undefined,
    _meta: row.charged
      ? { x402: { paymentRequired: true } }
      : { samedaydesk: { charged: false, paymentRequired: false } },
  }));
}

test("configured inventory keeps optional tools and recovery in registration order", () => {
  const absent = projectMcpInventory(configuredTools(), { nativeRecovery: true });
  assert.equal(absent.paidToolCount, 3);
  assert.equal(absent.toolCount, 7);
  assert.deepEqual(absent.tools.map((row) => row.name), [
    "careers_board", "extract", "read",
    "careers_board_cold", "report_caller_result", "trial_read", MCP_RECOVERY_TOOL,
  ]);
  assert.equal(absent.tools.find((row) => row.name === "page_change"), undefined);
  assert.equal(absent.tools.find((row) => row.name === "extract_batch"), undefined);
  assert.equal(absent.tools.find((row) => row.name === "lockfile_pin_delta"), undefined);
  assert.equal(absent.tools.find((row) => row.name === FREE_ONLY), undefined);
  assert.equal(absent.tools.find((row) => row.name === "trial_read").outputSchema, true);
  assert.equal(absent.tools.find((row) => row.name === "careers_board_cold").outputSchema, false);
  assert.equal(absent.tools.find((row) => row.name === MCP_RECOVERY_TOOL).charged, false);

  const batchOnly = projectMcpInventory(configuredTools({ extractBatch: true }), { nativeRecovery: true });
  assert.equal(batchOnly.paidToolCount, 4);
  assert.equal(batchOnly.tools.some((row) => row.name === "extract_batch"), true);
  assert.equal(batchOnly.tools.some((row) => row.name === "lockfile_pin_delta"), false);
  assert.equal(batchOnly.tools.some((row) => row.name === "page_change"), false);

  const full = projectMcpInventory(configuredTools({
    extractBatch: true, lockfile: true, pageChange: true,
  }), { nativeRecovery: true });
  assert.equal(full.paidToolCount, 5);
  assert.equal(full.toolCount, 10);
  assert.deepEqual(full.tools.filter((row) => row.charged === false).map((row) => row.name), [
    "page_change", "careers_board_cold", "report_caller_result", "trial_read", MCP_RECOVERY_TOOL,
  ]);
  assert.equal(full.tools.some((row) => row.name === FREE_ONLY), false);

  const noRecovery = projectMcpInventory(configuredTools({ pageChange: true }), { nativeRecovery: false });
  assert.equal(noRecovery.tools.some((row) => row.name === MCP_RECOVERY_TOOL), false);
  assert.equal(noRecovery.toolCount, noRecovery.paidToolCount + 4);
});

test("duplicate, colliding, unnamed, and drifted inventories fail closed", () => {
  assert.throws(() => projectMcpInventory([tool("extract"), tool("extract")]), /mcp_registered_inventory_drift:extract/);
  assert.throws(() => projectMcpInventory([tool(MCP_RECOVERY_TOOL)]), /mcp_registered_inventory_drift:recover_paid_result/);
  assert.throws(() => projectMcpInventory([tool("extract"), { name: "" }]), /unnamed/);
  assert.throws(() => projectMcpInventory(null), /tools/);
  const projection = projectMcpInventory([tool("extract", { outputSchema: schema })], { nativeRecovery: true });
  assert.throws(() => assertPreparedMatchesProjection(projection, [
    { name: "extract", outputSchema: schema },
  ]), /count:2:1/);
  assert.throws(() => assertPreparedMatchesProjection(projection, [
    { name: "extract", outputSchema: schema },
    { name: MCP_RECOVERY_TOOL, free: true, outputSchema: schema },
  ]), /recover_paid_result/);
  const prepared = [
    { name: "extract", outputSchema: schema },
    { name: MCP_RECOVERY_TOOL, free: true },
  ];
  assert.doesNotThrow(() => assertPreparedMatchesProjection(projection, prepared));
  assert.throws(() => assertSameMcpProjection(projection, {
    tools: [{ name: "extract", charged: true, outputSchema: false }, projection.tools[1]],
  }), /extract/);
});

test("catalog cache is public only after a ready mount", () => {
  assert.equal(mcpCatalogCacheControl("ready"), "public, max-age=300");
  assert.equal(mcpCatalogCacheControl("pending"), "no-store");
  assert.equal(mcpCatalogCacheControl("failed"), "no-store");
  assert.equal(mcpCatalogCacheControl("other"), "no-store");
  assert.equal(mcpCatalogCacheControl(undefined), "no-store");
});

test("descriptor follows mount state and rejects a charged free-tool detail", () => {
  const projection = projectMcpInventory(configuredTools(), { nativeRecovery: true });
  const pending = describeMcpCatalog({ state: "pending", projection, detailFor });
  assert.equal(pending.registered, false);
  assert.equal(pending.mountState, "pending");
  assert.equal(pending.toolCount, projection.toolCount);
  assert.equal(pending.freeTools.at(-1).name, MCP_RECOVERY_TOOL);
  assert.equal(pending.freeTools.find((tool) => tool.name === "report_caller_result").optional, true);
  const ready = describeMcpCatalog({ state: "ready", projection, detailFor });
  assert.equal(ready.registered, true);
  assert.equal(ready.paidToolCount, 3);
  const failed = describeMcpCatalog({ state: "failed", projection, detailFor });
  assert.equal(failed.registered, false);
  assert.equal(failed.toolCount, null);
  assert.deepEqual(failed.tools, []);
  assert.deepEqual(failed.freeTools, []);
  const startup = describeMcpCatalog({ state: "pending", projection: null, detailFor });
  assert.equal(startup.mountState, "pending");
  assert.equal(startup.toolCount, null);
  assert.throws(() => describeMcpCatalog({
    state: "ready",
    projection,
    detailFor: (name) => ({ name, charged: true }),
  }), /mcp_free_tool_detail_drift:careers_board_cold/);
});

test("historical view restores the paid count and drops only the projection delta", () => {
  const projection = projectMcpInventory(configuredTools({ pageChange: true }), { nativeRecovery: true });
  const current = {
    ...describeMcpCatalog({ state: "ready", projection, detailFor }),
    payment: "x402 USDC on Base per paid MCP tool call; page_change is free",
    endpoint: "https://agents.samedaydesk.com/mcp",
  };
  const historical = historicalMcpDescriptorView(current);
  assert.equal(historical.toolCount, current.paidToolCount);
  assert.equal(historical.registered, undefined);
  assert.equal(historical.mountState, undefined);
  assert.equal(historical.paidToolCount, undefined);
  assert.equal(historical.tools, undefined);
  assert.equal(historical.freeTools.some((tool) => tool.name === MCP_RECOVERY_TOOL), false);
  assert.equal(historical.freeTools.some((tool) => tool.name === "page_change"), true);
  assert.equal(historical.payment, current.payment);
  assert.equal(historical.endpoint, current.endpoint);
  const oldDocument = { toolCount: 23, freeTools: [{ name: "careers_board_cold", charged: false }], payment: "same" };
  assert.deepEqual(historicalMcpDescriptorView(oldDocument), oldDocument);
  assert.notDeepEqual(historical, current);
});

test("comparison catches a stale paid count, a missing tool, a false tool, and a schema flip", () => {
  const projection = projectMcpInventory(configuredTools({
    extractBatch: true, lockfile: true, pageChange: true,
  }), { nativeRecovery: true });
  const descriptor = describeMcpCatalog({ state: "ready", projection, detailFor });
  const listed = listedFrom(projection);
  assert.equal(compareMcpCatalog(descriptor, listed).ok, true);
  const stale = { ...descriptor, toolCount: descriptor.paidToolCount, tools: descriptor.tools.filter((tool) => tool.charged) };
  const staleResult = compareMcpCatalog(stale, listed);
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.differences.some((item) => item.code === "count" && item.advertised === 5 && item.listed === 10), true);
  assert.equal(staleResult.differences.some((item) => item.code === "names" && item.missing.includes(MCP_RECOVERY_TOOL)), true);
  const missing = listed.filter((tool) => tool.name !== "extract_batch");
  const missingResult = compareMcpCatalog(descriptor, missing);
  assert.equal(missingResult.differences.some((item) => item.code === "names" && item.unexpected.includes("extract_batch")), true);
  const extra = [...listed, { name: FREE_ONLY, outputSchema: schema, _meta: { samedaydesk: { charged: false } } }];
  const extraResult = compareMcpCatalog(descriptor, extra);
  assert.equal(extraResult.differences.some((item) => item.code === "names" && item.missing.includes(FREE_ONLY)), true);
  const flipped = listed.map((tool) => tool.name === "trial_read" ? { ...tool, outputSchema: undefined } : tool);
  const schemaResult = compareMcpCatalog(descriptor, flipped);
  assert.equal(schemaResult.differences.some((item) => item.code === "schema" && item.name === "trial_read"), true);
  const pending = describeMcpCatalog({ state: "pending", projection, detailFor });
  assert.equal(compareMcpCatalog(pending, listed).differences[0].code, "unregistered");
  const unrelated = { toolCount: 2, tools: [{ name: "other", charged: true, outputSchema: false }] };
  assert.equal(compareMcpCatalog({ ...unrelated, registered: true }, [
    { name: "other", _meta: { x402: { paymentRequired: true } } },
    { name: "second", _meta: { x402: { paymentRequired: true } } },
  ]).ok, false);
});
