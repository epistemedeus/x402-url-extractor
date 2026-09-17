export const PRODUCT = "samedaydesk-anthropic-unpaid-list";
export const SCHEMA_VERSION = "samedaydesk.anthropic-unpaid-list.v0";
export const RUNTIME = "anthropic-claude-code";
export const EXAMPLE_VERSION = "0.1.0";

export const LIVE_ORIGIN = "https://agents.samedaydesk.com";
export const LIVE_MCP_PATH = "/mcp";
export const LIVE_OPENAPI_PATH = "/openapi.json";
export const LIVE_WELL_KNOWN_PATH = "/.well-known/x402";
export const LIVE_ACTIONS_PATH = "/api/actions";
export const LIVE_EXTRACT_PATH = "/extract";
export const LIVE_EXTRACT_BATCH_PATH = "/extract/batch";

export const DEFAULT_PROBE_URL = "https://example.com";
export const DEFAULT_BATCH_URLS = Object.freeze(["https://example.com/", "https://example.org/"]);
export const DEFAULT_BATCH_FIELDS = Object.freeze(["title", "description", "headings"]);

export const MCP_PROTOCOL = "2025-11-25";
export const USER_AGENT = `samedaydesk-anthropic-unpaid-list/${EXAMPLE_VERSION}`;

export const DISCOVERY_MAX_BYTES = 256 * 1024;
export const MCP_MAX_BYTES = 256 * 1024;
export const PROBE_MAX_BYTES = 64 * 1024;
export const TRANSPORT_TIMEOUT_MS = 15_000;

export const EXTRACT_MCP_TOOLS = Object.freeze(["extract", "extract_batch"]);
export const EXTRACT_HTTP_ROUTES = Object.freeze(["/extract", "/extract/batch"]);

export const MARKETPLACE_NAME = "samedaydesk-claude";
export const MARKETPLACE_PLUGIN = "samedaydesk-extract";
export const MARKETPLACE_INSTALL = "samedaydesk-extract@samedaydesk-claude";

export const FORBIDDEN_CLI_FLAGS = Object.freeze([
  "--approve",
  "--pay",
  "--purchase",
  "--checkout",
  "--publish",
  "--neo",
  "--wallet",
  "--private-key",
  "--private-key-env",
  "--header",
  "--headers",
  "--payment-signature",
  "--x-payment",
  "--x-payment-signature",
]);

export const REQUEST_PAYMENT_HEADER_NAMES = Object.freeze([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
  "x-api-token",
  "api-key",
  "x-payment",
  "payment-signature",
  "x-payment-signature",
  "payment-response",
  "x-payment-response",
]);
