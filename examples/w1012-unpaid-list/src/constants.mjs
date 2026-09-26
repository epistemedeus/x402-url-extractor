/** Pinned SameDayDesk MCP. Discovery is unpaid. Tool calls are not this example. */
export const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
export const MCP_TRANSPORT = "streamable-http";
export const MCP_PROTOCOL = "2025-11-25";
export const FORBIDDEN_PROTOCOL = "2026-07-28";
export const CLIENT_NAME = "samedaydesk-w1012-unpaid-list";
export const CLIENT_VERSION = "0.1.0";
export const USER_AGENT = "SameDayDesk-w1012-unpaid-list/0.1.0";
export const REQUIRED_TOOLS = Object.freeze(["extract", "extract_batch"]);
export const ALLOWED_METHODS = Object.freeze(["initialize", "tools/list"]);
export const REPORT_SCHEMA = "samedaydesk.w1012-unpaid-list.report.v1";
export const SEED_SCHEMA = "samedaydesk.w1012-unpaid-list.seed.v1";
export const MCP_CONFIG_SCHEMA = "samedaydesk.w1012-unpaid-list.config.v1";
export const TIMEOUT_MS = 15_000;
export const MAX_BYTES = 1_000_000;
export const DESIGNATED_SEED_ID = "seeded.false-accept.missing-extract";
export const EXAMPLE_ID = "w1012-unpaid-list";
export const WORK_ITEM = "w1012";

export const PAYMENT_HEADER_NAMES = Object.freeze([
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-api-key",
  "x-api-token",
  "api-key",
  "x-payment",
  "payment-signature",
  "x-payment-signature",
  "payment-required",
]);

export const FORBIDDEN_HOST_FRAGMENTS = Object.freeze([
  "neomorphic.io",
  "neo.market",
]);

export const FORBIDDEN_FLAGS = Object.freeze([
  "--call",
  "--pay",
  "--approve",
  "--purchase",
  "--publish",
  "--neo",
  "--neomorphic",
  "--tools-call",
  "--checkout",
  "--wallet",
  "--header",
  "--headers",
  "--private-key",
  "--private-key-env",
  "--auth",
  "--token",
  "--bearer",
  "--npm-publish",
  "--registry",
]);
