import { TOOL_DESCRIPTION, TOOL_INPUT_SCHEMA, TOOL_NAME } from "./constants.mjs";
import { UnpaidListError } from "./errors.mjs";
import { listUnpaidResources } from "./list.mjs";

function normalizeToolInput(input) {
  if (input == null || input === "") return {};
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new UnpaidListError("tool input JSON must be an object", { code: "catalog_malformed", field: "input" });
      }
      return parsed;
    }
    return { query: trimmed };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new UnpaidListError("tool input must be an object or query string", { code: "catalog_malformed", field: "input" });
  }
  return input;
}

export function createUnpaidListTool(defaults = {}) {
  async function invoke(input = {}) {
    const normalized = normalizeToolInput(input);
    const extra = Object.keys(normalized).filter((key) => key !== "query" && key !== "route");
    if (extra.length) {
      const payment = /^(approve|pay|wallet|checkout|privateKey|privateKeyEnv|paymentSignature|paymentHeader|account)$/;
      throw new UnpaidListError(`unsupported tool field: ${extra[0]}`, {
        code: payment.test(extra[0]) ? "payment_intent_refused" : "unknown_argument",
        field: extra[0],
      });
    }
    const report = await listUnpaidResources({
      ...defaults,
      query: normalized.query,
      route: normalized.route,
    });
    return JSON.stringify(report);
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    schema: TOOL_INPUT_SCHEMA,
    invoke,
    func: invoke,
    call: invoke,
  };
}

export const unpaidListTool = createUnpaidListTool();

export function langchainToolSpec() {
  return {
    type: "function",
    function: {
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: TOOL_INPUT_SCHEMA,
    },
  };
}
