import { REQUIRED_TOOLS } from "./constants.mjs";
import { fail } from "./errors.mjs";

export function acceptInventory(tools, { required = REQUIRED_TOOLS } = {}) {
  if (!Array.isArray(tools)) {
    fail("INVENTORY_REJECT", "tools/list must return an array", { kind: "missing_tools" });
  }
  const names = [];
  const seen = new Set();
  for (const tool of tools) {
    const name = tool?.name;
    if (typeof name !== "string" || name.length === 0) {
      fail("INVENTORY_REJECT", "tools/list contains a missing name", { kind: "missing_name" });
    }
    if (seen.has(name)) {
      fail("INVENTORY_REJECT", `tools/list duplicate name ${name}`, { kind: "duplicate_name" });
    }
    seen.add(name);
    names.push(name);
  }
  for (const need of required) {
    if (!seen.has(need)) {
      fail("INVENTORY_REJECT", `tools/list missing ${need}`, {
        kind: "missing_required",
        details: { missing: need, names },
      });
    }
  }
  const extract = tools.find((tool) => tool.name === "extract");
  const extractBatch = tools.find((tool) => tool.name === "extract_batch");
  if (!extract?.inputSchema || typeof extract.inputSchema !== "object") {
    fail("INVENTORY_REJECT", "extract is missing inputSchema", { kind: "missing_schema" });
  }
  if (!extractBatch?.inputSchema || typeof extractBatch.inputSchema !== "object") {
    fail("INVENTORY_REJECT", "extract_batch is missing inputSchema", { kind: "missing_schema" });
  }
  const extractProps = extract.inputSchema.properties;
  if (!extractProps || typeof extractProps !== "object" || !extractProps.url) {
    fail("INVENTORY_REJECT", "extract inputSchema must include url", { kind: "missing_schema" });
  }
  if (!Array.isArray(extract.inputSchema.required) || !extract.inputSchema.required.includes("url")) {
    fail("INVENTORY_REJECT", "extract inputSchema.required must include url", { kind: "missing_schema" });
  }
  const batchProps = extractBatch.inputSchema.properties;
  if (!batchProps || typeof batchProps !== "object" || !batchProps.urls) {
    fail("INVENTORY_REJECT", "extract_batch inputSchema must include urls", { kind: "missing_schema" });
  }
  if (!Array.isArray(extractBatch.inputSchema.required) || !extractBatch.inputSchema.required.includes("urls")) {
    fail("INVENTORY_REJECT", "extract_batch inputSchema.required must include urls", { kind: "missing_schema" });
  }
  return {
    ok: true,
    names,
    toolCount: names.length,
    requiredPresent: Object.fromEntries(required.map((name) => [name, true])),
  };
}

export function tryAcceptInventory(tools) {
  try {
    return acceptInventory(tools);
  } catch (error) {
    return {
      ok: false,
      code: error.code || "INVENTORY_REJECT",
      kind: error.kind || "inventory",
      message: error.message,
      details: error.details || null,
    };
  }
}
