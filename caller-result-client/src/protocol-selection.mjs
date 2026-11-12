// Protocol capability selection for the installed SameDayDesk free-compare
// clients and recipes (Node client, Python, curl, A2A). Dependency-free.
//
// A client reads the version the server actually advertised (the initialize
// result's protocolVersion, or the agent card's supportedInterfaces[].protocolVersion)
// and proceeds only on an exact string match with the lists below. Anything
// else is a typed protocol_version_unsupported refusal naming what was
// advertised. There is no silent upgrade and no fallback guess.
//
// Where the lists come from (change them only when this source changes):
// - MCP server: POST /mcp/page-change runs the repo's pinned
//   @modelcontextprotocol/sdk 1.32.2 (package.json, package-lock.json). Its
//   dist/esm/types.js sets SUPPORTED_PROTOCOL_VERSIONS to the five versions in
//   MCP_SERVER_SDK_PROTOCOL_VERSIONS, with LATEST_PROTOCOL_VERSION 2025-11-25.
//   This client package pins sdk 1.30.0, which lists the same five
//   (Compatibility Knowledge corpus: docs/reviews/h99110-mcp-current-client-compat/RESULT.md).
// - Recipes read structuredContent and tool _meta, which the wire carries from
//   2025-06-18 on, so they accept only 2025-11-25 and 2025-06-18 from that list.
// - MCP 2026-07-28 is not implemented by this source. The same corpus records
//   the free profile answering HTTP 400 "Unsupported protocol version" to it.
//   A published changelog is not evidence that this server or its consumers support it.
// - A2A: a2a-storefront.mjs A2A_VERSION "1.0", advertised in the agent card.
export const MCP_SERVER_SDK = Object.freeze({ name: "@modelcontextprotocol/sdk", version: "1.32.2" });
export const MCP_SERVER_SDK_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"]);
export const MCP_RECIPE_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18"]);
export const MCP_REQUESTED_PROTOCOL_VERSION = "2025-11-25";
export const A2A_RECIPE_PROTOCOL_VERSIONS = Object.freeze(["1.0"]);
export const PROTOCOL_VERSION_UNSUPPORTED = "protocol_version_unsupported";
const ADVERTISED_MAX_CHARS = 64;
const MAX_ADVERTISED = 8;

/** initialize request the recipes send before tools/call. */
export function mcpInitializeRequest(id = 0) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: MCP_REQUESTED_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "samedaydesk-free-continuation", version: "1" } },
  };
}

/** The protocolVersion an initialize reply advertised, or null. */
export function advertisedMcpVersion(reply) {
  const value = reply?.result?.protocolVersion;
  return typeof value === "string" ? value : null;
}

/** Every protocolVersion an A2A agent card advertises, in card order. */
export function advertisedA2aVersions(card) {
  const interfaces = Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces : [];
  return interfaces.map((entry) => entry?.protocolVersion).filter((value) => typeof value === "string");
}

/**
 * Exact-match selection. advertised is one version string or a list (A2A).
 * Returns { ok: true, protocolVersion } or a refusal body with code
 * protocol_version_unsupported, the advertised values (bounded) and the
 * supported list.
 */
export function selectProtocolVersion(advertised, supported) {
  const offered = (Array.isArray(advertised) ? advertised : [advertised]).filter((value) => typeof value === "string").slice(0, MAX_ADVERTISED);
  const match = offered.find((value) => supported.includes(value));
  if (match) return { ok: true, protocolVersion: match };
  return {
    ok: false,
    charged: false,
    code: PROTOCOL_VERSION_UNSUPPORTED,
    advertised: offered.map((value) => value.slice(0, ADVERTISED_MAX_CHARS)),
    supported: [...supported],
    nextStep: "The server advertised no protocol version this client implements. Use a client release that lists the advertised version; do not force a version.",
  };
}

/**
 * The MCP SDK client throws before connect returns when the server's version
 * is outside the SDK list. Map that error to the same typed refusal.
 */
export function protocolRefusalFromSdkError(error) {
  const match = /^Server's protocol version is not supported: (.{1,64})$/.exec(String(error?.message ?? ""));
  return match ? selectProtocolVersion(match[1], MCP_RECIPE_PROTOCOL_VERSIONS) : null;
}
