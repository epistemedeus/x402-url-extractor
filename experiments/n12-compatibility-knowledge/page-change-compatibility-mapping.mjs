// Reusable checks and mappings from actual page-change interoperability
// failures, composed for the existing free MCP consumer workflow.
// Source pin: epistemedeus/x402-url-extractor e90676f48da875c5e0f475f57f7774de947b75a7.
// This module does not change handlers, add aliases, take payment, or implement
// MCP Tasks or A2A Task migration.

export const MERCHANT_REPO = "epistemedeus/x402-url-extractor";
export const MERCHANT_PIN = "e90676f48da875c5e0f475f57f7774de947b75a7";

export const FREE_PAGE_CHANGE = Object.freeze({
  path: "/mcp/page-change",
  tool: "compare_page_observations",
  protocol: "2025-11-25",
  refusedProtocol: "2026-07-28",
  charged: false,
  paymentRequired: false,
  fetchesUrls: false,
});

// Official MCP Tasks extension. The installed free profile returns a
// synchronous CallToolResult and does not materialize a task handle. A server
// must not return a Task to a caller that did not declare support. This pack
// keeps that synchronous contract.
export const TASKS_EXTENSION = Object.freeze({
  id: "io.modelcontextprotocol/tasks",
  implementedOnFreeProfile: false,
  resultTypeTask: "task",
  mustNotReturnTaskWithoutDeclaration: true,
});

// PR 271 / live recovery 2026-11-09: tools/call of an unrecognized name used
// to return only -32602 "Unknown tool", which left official clients with no
// route-specific recovery cue. The installed handler adds error.data and does
// not reflect the caller name or fall back to a paid tool.
export const UNKNOWN_TOOL_RECOVERY = Object.freeze({
  origin: Object.freeze({
    writer: "epistemedeus",
    pullRequest: 271,
    branch: "codex/page-change-mcp-recovery-20261109",
    mergeCommit: MERCHANT_PIN,
    olderProtocolCheck: Object.freeze({
      path: "test/mcp-unknown-tool.test.mjs",
      commit: "3567b74de03b3c284c0b296c2157744d56ca0acb",
    }),
  }),
  jsonRpcCode: -32602,
  message: "Unknown tool",
  nextMethod: "tools/list",
  availableTools: Object.freeze([FREE_PAGE_CHANGE.tool]),
});

// H99110 / PR 250: official legacy 1.30.0 and current 2.4.0 clients already
// reach the free profile through supported negotiation. An explicit 2026-07-28
// pin is refused on POST /mcp/page-change. No protocol rewrite belongs here.
export const OFFICIAL_CLIENT_NEGOTIATION = Object.freeze({
  origin: Object.freeze({
    writer: "epistemedeus",
    assignment: "H99110",
    pullRequest: 250,
    introducingCommit: "53069cfcb3094dc7f1b97ddfe4446dbe5c14c437",
    mergeCommit: "ff61d7c688e2448fcab508feae4fc527ac3e3d7c",
    testPath: "mcp-current-client-compat.test.mjs",
  }),
  legacySdk: "1.30.0",
  currentClient: "2.4.0",
  supportedFreeProtocol: FREE_PAGE_CHANGE.protocol,
  refusedFreeProtocol: FREE_PAGE_CHANGE.refusedProtocol,
});

// Existing caller-result recovery package, composed by contract only. This
// pack does not start a paid recovery, import Agent Entry continuation, or
// add HMAC files.
export const CALLER_RESULT_RECOVERY = Object.freeze({
  origin: Object.freeze({
    writer: "epistemedeus",
    introducingCommit: "9249d42cf1c324dfae969ab1f61c55bea71d4c35",
    pinPath: "caller-result-client/PIN.json",
  }),
  pinPath: "caller-result-client/PIN.json",
  package: "samedaydesk-caller-result",
  version: "0.1.2",
  sdk: "@modelcontextprotocol/sdk",
  sdkVersion: "1.30.0",
  tool: "report_caller_result",
  module: "caller-result-client/src/mcp-recovery.mjs",
  bin: "caller-result-client/bin/recover-mcp.mjs",
  packageExport: "./recovery",
  charged: false,
});

export function unknownToolErrorData() {
  return {
    nextMethod: UNKNOWN_TOOL_RECOVERY.nextMethod,
    availableTools: [...UNKNOWN_TOOL_RECOVERY.availableTools],
  };
}

// Map a JSON-RPC unknown-tool failure to the existing recovery step. Reject
// shapes that echo the caller-supplied name, point at a paid tool, or omit
// the tools/list cue.
export function mapUnknownToolRecovery(error, { attemptedName } = {}) {
  const code = error?.code;
  const message = error?.message;
  const data = error?.data;
  if (code !== UNKNOWN_TOOL_RECOVERY.jsonRpcCode) {
    throw new Error("unknown_tool_recovery_unmapped");
  }
  if (message !== UNKNOWN_TOOL_RECOVERY.message) {
    throw new Error("unknown_tool_recovery_unmapped");
  }
  if (!data || data.nextMethod !== UNKNOWN_TOOL_RECOVERY.nextMethod) {
    throw new Error("unknown_tool_recovery_unmapped");
  }
  const tools = Array.isArray(data.availableTools) ? data.availableTools : [];
  if (tools.length !== 1 || tools[0] !== FREE_PAGE_CHANGE.tool) {
    throw new Error("unknown_tool_recovery_unmapped");
  }
  if (tools.some((name) => name !== FREE_PAGE_CHANGE.tool)) {
    throw new Error("unknown_tool_recovery_paid_fallback");
  }
  const serialized = JSON.stringify(error);
  if (attemptedName && serialized.includes(attemptedName)) {
    throw new Error("unknown_tool_recovery_reflected_name");
  }
  return {
    nextMethod: data.nextMethod,
    tool: tools[0],
    paidFallback: false,
  };
}

export function omitSelectedTitle(request) {
  const next = structuredClone(request);
  const source = next?.after?.sources?.[0];
  if (source?.data && Object.hasOwn(source.data, "title")) delete source.data.title;
  return next;
}
