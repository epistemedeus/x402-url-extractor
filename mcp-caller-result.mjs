// Optional native-MCP statement for one sealed morpho_position result.
// The capability lives only in result _meta. It is not a payer, a price,
// or an event id. Official @x402/mcp callTool omits _meta, so this reader
// uses the MCP SDK Client result that still carries it.
import {
  MCP_CALLER_RESULT_META_KEY,
  MCP_CALLER_RESULT_TOOL,
  mcpCallerResultFeedbackPublicContract,
} from "./caller-result-feedback.mjs";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,1500}\.[A-Za-z0-9_-]{43}$/;

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function readMcpCallerResultCapability(result) {
  const absent = (reason) => ({ present: false, token: null, tool: null, reason });
  if (!plain(result)) return absent("absent");
  const meta = result._meta?.[MCP_CALLER_RESULT_META_KEY];
  if (meta === undefined) return absent("absent");
  if (!plain(meta)) return absent("malformed_capability");
  const contract = mcpCallerResultFeedbackPublicContract();
  const allowed = new Set([...Object.keys(contract), "token"]);
  const keys = Object.keys(meta);
  if (keys.some((key) => !allowed.has(key))) return absent("unbounded_field");
  for (const [key, value] of Object.entries(contract)) {
    if (!sameJson(meta[key], value)) return absent("contract_rejected");
  }
  if (meta.channel !== "mcp" || meta.optional !== true || meta.charged !== false) {
    return absent("contract_rejected");
  }
  if (meta.tool !== MCP_CALLER_RESULT_TOOL) return absent("foreign_tool");
  if (typeof meta.token !== "string" || !TOKEN_RE.test(meta.token)) return absent("malformed_capability");
  const published = JSON.stringify({ ...meta, token: undefined });
  if (published.includes("http://") || published.includes("https://") || published.includes("?")) {
    return absent("link_rejected");
  }
  return {
    present: true,
    token: meta.token,
    tool: MCP_CALLER_RESULT_TOOL,
    reason: null,
  };
}

function safeBody(body) {
  if (!plain(body)) return null;
  return {
    ok: body.ok === true,
    accepted: body.accepted === true,
    bound: body.bound === true,
    charged: false,
    payerIdentity: false,
    usefulness: "unknown",
    code: typeof body.code === "string" ? body.code : null,
    disposition: body.disposition === "useful" || body.disposition === "not_useful" ? body.disposition : null,
    reasonCategory: typeof body.reasonCategory === "string" || body.reasonCategory === null
      ? body.reasonCategory
      : null,
    idempotentReplay: body.idempotentReplay === true,
    retainedDisposition: body.retainedDisposition === "useful" || body.retainedDisposition === "not_useful"
      ? body.retainedDisposition
      : null,
    retainedReasonCategory: typeof body.retainedReasonCategory === "string" || body.retainedReasonCategory === null
      ? body.retainedReasonCategory
      : null,
    coverage: body.coverage === "this_retained_result_only" ? body.coverage : null,
  };
}

export async function reportMcpCallerResult(client, { token, disposition, reasonCategory } = {}) {
  const refused = (code) => ({
    ok: false,
    accepted: false,
    bound: false,
    charged: false,
    payerIdentity: false,
    usefulness: "unknown",
    code,
    disposition: null,
    reasonCategory: null,
    idempotentReplay: false,
    retainedDisposition: null,
    retainedReasonCategory: null,
    coverage: null,
  });
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return refused("malformed_capability");
  if (disposition !== "useful" && disposition !== "not_useful") return refused("disposition_rejected");
  const args = { token, disposition };
  if (reasonCategory !== undefined) args.reasonCategory = reasonCategory;
  let result;
  try {
    if (!client || typeof client.callTool !== "function") return refused("transport_failed");
    result = await client.callTool({
      name: MCP_CALLER_RESULT_TOOL,
      arguments: args,
    });
  } catch {
    return refused("transport_failed");
  }
  let encoded = "";
  try {
    encoded = JSON.stringify(result);
  } catch {
    return refused("malformed_result");
  }
  if (encoded.includes(token) || encoded.includes("http://") || encoded.includes("https://")) {
    return refused("bearer_retained");
  }
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return refused("malformed_result");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refused("malformed_result");
  }
  const body = safeBody(parsed);
  if (!body) return refused("malformed_result");
  return body;
}
