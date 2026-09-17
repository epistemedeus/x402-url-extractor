/** Immutable pins for the OpenAI Agents unpaid-call example. */

export const SDK_PACKAGE = "@openai/agents";
export const SDK_VERSION = "0.18.0";
export const SDK_METHOD = "MCPServerStreamableHttp.callToolResult";
export const SDK_CALLTOOL_METHOD = "MCPServerStreamableHttp.callTool";
export const SDK_DOCS =
  "https://openai.github.io/openai-agents-js/openai/agents-core/classes/mcpserverstreamablehttp/";
export const X402_MCP_TRANSPORT =
  "https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md";

export const PRODUCT = "samedaydesk-openai-agents-unpaid-call";
export const SCHEMA_VERSION = "samedaydesk.openai-agents-unpaid-call.v0";

export const DEFAULT_TOOL_NAME = "extract";
export const DEFAULT_TOOL_ARGS = Object.freeze({ url: "https://example.com/" });

export const MOCK_SERVER_NAME = "samedaydesk-unpaid-mcp-mock";
export const MOCK_SERVER_VERSION = "0.1.0";
export const MOCK_PROTOCOL_VERSIONS = Object.freeze([
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
  "2024-11-05",
]);
export const MOCK_DEFAULT_PROTOCOL = "2025-03-26";
