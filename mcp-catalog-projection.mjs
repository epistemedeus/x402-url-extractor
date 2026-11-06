// One projection of the tools mountMcp registers. GET /mcp and tools/list
// both read this inventory. It is not a second registry, and it does not
// decide which optional tools exist. The caller passes the configured list.

import { MCP_RECOVERY_TOOL } from "./idempotency-replay.mjs";

export { MCP_RECOVERY_TOOL };

function toolRow(tool) {
  const name = tool?.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("mcp_registered_inventory_drift:unnamed");
  }
  return {
    name,
    charged: tool.free !== true,
    outputSchema: Boolean(tool.outputSchema),
  };
}

export function projectMcpInventory(tools, { nativeRecovery = false } = {}) {
  if (!Array.isArray(tools)) throw new Error("mcp_registered_inventory_drift:tools");
  const seen = new Set();
  const paid = [];
  const free = [];
  for (const tool of tools) {
    const row = toolRow(tool);
    if (seen.has(row.name) || row.name === MCP_RECOVERY_TOOL) {
      throw new Error(`mcp_registered_inventory_drift:${row.name}`);
    }
    seen.add(row.name);
    if (row.charged) paid.push(row);
    else free.push(row);
  }
  const ordered = [...paid, ...free];
  if (nativeRecovery) {
    ordered.push({ name: MCP_RECOVERY_TOOL, charged: false, outputSchema: false });
  }
  return Object.freeze({
    toolCount: ordered.length,
    paidToolCount: paid.length,
    freeToolCount: ordered.length - paid.length,
    tools: Object.freeze(ordered.map((row) => Object.freeze({ ...row }))),
  });
}

export function assertPreparedMatchesProjection(projection, prepared) {
  const expected = projection?.tools || [];
  const actual = (prepared || []).map((tool) => toolRow(tool));
  if (actual.length !== expected.length) {
    throw new Error(`mcp_registered_inventory_drift:count:${expected.length}:${actual.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (left.name !== right.name || left.charged !== right.charged || left.outputSchema !== right.outputSchema) {
      throw new Error(`mcp_registered_inventory_drift:${right.name || left.name || index}`);
    }
  }
}

export function assertSameMcpProjection(left, right) {
  assertPreparedMatchesProjection(left, (right?.tools || []).map((tool) => ({
    name: tool.name,
    free: tool.charged !== true,
    outputSchema: tool.outputSchema ? { declared: true } : undefined,
  })));
}

// A shared cache may store GET /mcp for the ready document's max-age.
// Pending and failed documents are not that document. They stay uncached
// so a startup or failed mount cannot hide the registered inventory.
export function mcpCatalogCacheControl(state) {
  return state === "ready" ? "public, max-age=300" : "no-store";
}

export function describeMcpCatalog({ state = "pending", projection = null, detailFor } = {}) {
  const mountState = state === "ready" || state === "pending" || state === "failed" ? state : "failed";
  if (!projection || mountState === "failed") {
    return {
      registered: false,
      mountState: mountState === "pending" ? "pending" : "failed",
      toolCount: null,
      paidToolCount: null,
      tools: [],
      freeTools: [],
    };
  }
  if (typeof detailFor !== "function") throw new Error("mcp_free_tool_detail_drift:missing");
  const freeTools = [];
  for (const tool of projection.tools) {
    if (tool.charged) continue;
    const detail = detailFor(tool.name);
    if (!detail || detail.name !== tool.name || detail.charged !== false) {
      throw new Error(`mcp_free_tool_detail_drift:${tool.name}`);
    }
    freeTools.push(detail);
  }
  return {
    registered: mountState === "ready",
    mountState,
    toolCount: projection.toolCount,
    paidToolCount: projection.paidToolCount,
    tools: projection.tools.map((tool) => ({
      name: tool.name,
      charged: tool.charged,
      outputSchema: tool.outputSchema,
    })),
    freeTools,
  };
}

// Admitted historical documents counted paid resources and omitted recovery.
// Strip only that projection delta. Paid challenges and human bytes stay put.
export function historicalMcpDescriptorView(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) return descriptor;
  const view = { ...descriptor };
  if (typeof view.paidToolCount === "number") view.toolCount = view.paidToolCount;
  delete view.registered;
  delete view.mountState;
  delete view.paidToolCount;
  delete view.tools;
  if (Array.isArray(view.freeTools)) {
    view.freeTools = view.freeTools.filter((tool) => tool?.name !== MCP_RECOVERY_TOOL);
  }
  return view;
}

function listedCharge(tool) {
  const desk = tool?._meta?.samedaydesk;
  if (desk && (desk.charged === false || desk.paymentRequired === false)) return false;
  if (tool?._meta?.x402?.paymentRequired === true) return true;
  return null;
}

export function compareMcpCatalog(descriptor, listedTools) {
  const differences = [];
  const listed = Array.isArray(listedTools) ? listedTools : [];
  const projected = Array.isArray(descriptor?.tools) ? descriptor.tools : [];
  if (descriptor?.registered !== true) {
    differences.push({ code: "unregistered", mountState: descriptor?.mountState ?? null });
  }
  if (descriptor?.toolCount !== listed.length) {
    differences.push({ code: "count", advertised: descriptor?.toolCount ?? null, listed: listed.length });
  }
  const projectedNames = projected.map((tool) => tool?.name);
  const listedNames = listed.map((tool) => tool?.name);
  if (projectedNames.join("\n") !== listedNames.join("\n")) {
    differences.push({
      code: "names",
      missing: listedNames.filter((name) => !projectedNames.includes(name)),
      unexpected: projectedNames.filter((name) => !listedNames.includes(name)),
    });
  }
  for (const tool of listed) {
    const row = projected.find((item) => item?.name === tool?.name);
    if (!row) continue;
    const schema = Boolean(tool?.outputSchema);
    if (row.outputSchema !== schema) {
      differences.push({ code: "schema", name: tool.name, advertised: row.outputSchema, listed: schema });
    }
    const charged = listedCharge(tool);
    if (charged !== null && row.charged !== charged) {
      differences.push({ code: "charged", name: tool.name, advertised: row.charged, listed: charged });
    }
  }
  return { ok: differences.length === 0, differences };
}
