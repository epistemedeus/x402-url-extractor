/** Pins for unpaid SameDayDesk MCP tools/list via OpenAI Agents. */

export const LIVE_MCP_ORIGIN = "https://agents.samedaydesk.com";
export const LIVE_MCP_PATH = "/mcp";
export const LIVE_MCP_URL = `${LIVE_MCP_ORIGIN}${LIVE_MCP_PATH}`;
export const LIVE_MCP_HOST = "agents.samedaydesk.com";

export const SDK_PACKAGE = "@openai/agents";
export const SDK_VERSION = "0.18.0";
export const MCP_CLIENT_PACKAGE = "@modelcontextprotocol/client";
export const MCP_CLIENT_VERSION = "2.0.0";
export const TRANSPORT_CLASS = "MCPServerStreamableHttp";

export const CLIENT_NAME = "samedaydesk-openai-agents-sds-mcp-list";
export const CLIENT_VERSION = "0.1.0";
export const USER_AGENT = `${CLIENT_NAME}/${CLIENT_VERSION}`;
export const SOURCE_HEADER = "X-SameDayDesk-Agent-Source";
export const SOURCE_HEADER_VALUE = "openai-agents-sds-mcp-list-v1";

export const INITIALIZE_ERA_PROTOCOL = "2025-11-25";
export const MODERN_PROTOCOL_PROBE = "2026-07-28";

export const REQUIRED_TOOLS = Object.freeze(["extract", "extract_batch"]);

export const CONNECT_TIMEOUT_SECONDS = 15;
export const REQUEST_TIMEOUT_MS = 15_000;

export const ALLOWED_RPC_METHODS = Object.freeze([
  "server/discover",
  "initialize",
  "notifications/initialized",
  "tools/list",
  "ping",
]);

export const ALLOWED_HTTP_METHODS = Object.freeze(["GET", "POST", "DELETE"]);

export const CREDENTIAL_HEADER_NAMES = Object.freeze([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-api-token",
  "api-key",
  "x-payment",
  "payment-signature",
  "x-payment-signature",
  "payment-required",
]);

export const REFUSED_CLI_FLAGS = Object.freeze([
  "--call",
  "--approve",
  "--pay",
  "--purchase",
  "--wallet",
  "--header",
  "--headers",
  "--private-key",
  "--private-key-env",
  "--auth",
  "--token",
  "--bearer",
]);
