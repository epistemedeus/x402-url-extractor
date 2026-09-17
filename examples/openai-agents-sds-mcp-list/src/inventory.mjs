import { REQUIRED_TOOLS } from "./constants.mjs";
import { InventoryError } from "./errors.mjs";

function fail(message, field = null) {
  throw new InventoryError(message, { field });
}

function schemaObject(tool, key) {
  const value = tool?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${tool?.name || "tool"} missing ${key}`, key);
  }
  return value;
}

export function assertUnpaidListInventory(tools) {
  if (!Array.isArray(tools)) fail("tools/list must return an array", "tools");
  const names = tools.map((tool) => tool?.name);
  const found = {};

  for (const required of REQUIRED_TOOLS) {
    const matches = tools.filter((tool) => tool?.name === required);
    if (matches.length !== 1) {
      fail(`tools/list missing or duplicate ${required}`, required);
    }
    const tool = matches[0];
    const inputSchema = schemaObject(tool, "inputSchema");
    if (inputSchema.type !== "object") {
      fail(`${required} inputSchema.type must be object`, required);
    }
    found[required] = tool;
  }

  const extractInput = found.extract.inputSchema;
  if (!extractInput.properties || typeof extractInput.properties !== "object") {
    fail("extract inputSchema.properties is required", "extract");
  }
  if (!extractInput.properties.url) {
    fail("extract inputSchema must include url", "extract");
  }
  if (!Array.isArray(extractInput.required) || !extractInput.required.includes("url")) {
    fail("extract inputSchema.required must include url", "extract");
  }

  const batchInput = found.extract_batch.inputSchema;
  if (!batchInput.properties || typeof batchInput.properties !== "object") {
    fail("extract_batch inputSchema.properties is required", "extract_batch");
  }
  if (!batchInput.properties.urls) {
    fail("extract_batch inputSchema must include urls", "extract_batch");
  }
  if (!Array.isArray(batchInput.required) || !batchInput.required.includes("urls")) {
    fail("extract_batch inputSchema.required must include urls", "extract_batch");
  }

  return {
    names,
    extract: found.extract,
    extract_batch: found.extract_batch,
    extractPresent: true,
    extractBatchPresent: true,
    extractInputRequiresUrl: true,
    extractBatchInputRequiresUrls: true,
    exactGlobalCountRequired: false,
  };
}
