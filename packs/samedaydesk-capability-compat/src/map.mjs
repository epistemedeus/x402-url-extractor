import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pinPath = join(dirname(fileURLToPath(import.meta.url)), "../PIN.json");

export const PIN = JSON.parse(readFileSync(pinPath, "utf8"));

export const FREE_PAGE_CHANGE = Object.freeze({
  path: "/mcp/page-change",
  tool: "compare_page_observations",
  serverName: "samedaydesk-page-compare",
  charged: false,
  documentedHostedEntry: "https://agents.samedaydesk.com/mcp/page-change",
  documentedHostedEntryLive: false,
});

// Shapes quoted from mcp-current-client-compat.test.mjs at merchant pin e90676f4.
export const OFFICIAL_CLIENT_NEGOTIATION = Object.freeze({
  legacyProtocol: "2025-11-25",
  refusedProtocol: "2026-07-28",
  pinClientName: "current-pin",
  pinClientVersion: "2.4.0",
  pinClientErrorCode: "ERA_NEGOTIATION_FAILED",
  discoverHttpStatus: 400,
  discoverJsonRpcCode: -32000,
  discoverMessageUnsupported: /Unsupported protocol version: 2026-07-28/,
  discoverMessageSupported: /2025-11-25/,
  introducingCommit: "53069cfcb3094dc7f1b97ddfe4446dbe5c14c437",
  sourceTest: "mcp-current-client-compat.test.mjs",
  lockedSdk: "1.32.2",
  lockedCurrentClient: "2.4.0",
  writerBaseSdk: "1.30.0",
});

// Shape quoted from page-change-mcp.http.test.mjs / unknownToolError at e90676f4.
export const UNKNOWN_TOOL_RECOVERY = Object.freeze({
  jsonRpcCode: -32602,
  message: "Unknown tool",
  nextMethod: "tools/list",
  availableTools: ["compare_page_observations"],
  exampleUnknownName: "not_a_tool",
  mergedAt: "e90676f48da875c5e0f475f57f7774de947b75a7",
});

export const CLIENT_SDK = Object.freeze({
  legacy: { id: "1.32.2", package: "@modelcontextprotocol/sdk", kind: "legacy" },
  current: { id: "2.4.0", package: "@modelcontextprotocol/client", kind: "current" },
});

export function mapClientSdk(version) {
  const value = String(version || "").trim();
  if (value === "2.4.0" || value === "current" || value === "@modelcontextprotocol/client") {
    return CLIENT_SDK.current;
  }
  if (value === "1.32.2" || value === "1.30.0" || value === "legacy" || value === "@modelcontextprotocol/sdk") {
    return CLIENT_SDK.legacy;
  }
  throw new Error(`unsupported client SDK version: ${value}`);
}
