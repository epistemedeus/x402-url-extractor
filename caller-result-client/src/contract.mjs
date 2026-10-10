// Public capability contract for one optional caller statement.
// No HMAC key, journal, signer, or merchant server module belongs here.
export const CALLER_RESULT_FEEDBACK_PATH = "/commerce/caller-result-feedback";
export const CALLER_RESULT_FEEDBACK_HEADER = "x-samedaydesk-caller-result-feedback";
export const CALLER_RESULT_FEEDBACK_LINK = `<${CALLER_RESULT_FEEDBACK_PATH}>; rel="caller-result-feedback"`;
export const CALLER_RESULT_FEEDBACK_SCHEMA = "samedaydesk.caller-result-feedback.v1";
export const CALLER_RESULT_FEEDBACK_MCP_SCHEMA = "samedaydesk.caller-result-feedback.mcp.v1";
export const CALLER_RESULT_USEFULNESS = "unknown";
export const MCP_CALLER_RESULT_TOOL = "report_caller_result";
export const MCP_CALLER_RESULT_META_KEY = "samedaydesk/mcp-caller-result";
export const MCP_CALLER_RESULT_METHOD = "tools/call";
export const CALLER_RESULT_DISPOSITIONS = Object.freeze(["useful", "not_useful"]);
export const CALLER_RESULT_REASON_CATEGORIES = Object.freeze([
  "matched_task",
  "saved_a_step",
  "wrong_output",
  "missing_field",
  "not_actionable",
]);
export const CALLER_RESULT_TOKEN_RE = /^[A-Za-z0-9_-]{20,1500}\.[A-Za-z0-9_-]{43}$/;

export function mcpCallerResultFeedbackPublicContract() {
  return {
    optional: true,
    charged: false,
    payerIdentity: false,
    usefulness: CALLER_RESULT_USEFULNESS,
    channel: "mcp",
    schema: CALLER_RESULT_FEEDBACK_MCP_SCHEMA,
    tool: MCP_CALLER_RESULT_TOOL,
    dispositions: [...CALLER_RESULT_DISPOSITIONS],
    reasonCategories: [...CALLER_RESULT_REASON_CATEGORIES],
  };
}

export function callerResultFeedbackPublicContract() {
  return {
    optional: true,
    charged: false,
    payerIdentity: false,
    usefulness: CALLER_RESULT_USEFULNESS,
    method: "POST",
    path: CALLER_RESULT_FEEDBACK_PATH,
    header: CALLER_RESULT_FEEDBACK_HEADER,
    dispositions: [...CALLER_RESULT_DISPOSITIONS],
    reasonCategories: [...CALLER_RESULT_REASON_CATEGORIES],
  };
}
