// One raw POST /mcp JSON-RPC ceiling. Ordinary HTTP JSON stays at 16 KiB.
// The largest advertised MCP tool-argument budget is the lockfile compare.
// The raw body must also carry the JSON-RPC envelope and payment metadata.
export const ORDINARY_HTTP_JSON_MAX_BYTES = 16 * 1024;
export const MCP_TOOL_ARGUMENT_MAX_BYTES = 256 * 1024;
export const MCP_JSON_RPC_ENVELOPE_ALLOWANCE_BYTES = 32 * 1024;
export const MCP_JSON_RPC_MAX_BYTES = MCP_TOOL_ARGUMENT_MAX_BYTES + MCP_JSON_RPC_ENVELOPE_ALLOWANCE_BYTES;
export const MCP_CONTINUATION_OPERATION_MAX_BYTES = 64 * 1024;
export const MCP_JSON_RPC_OVERLIMIT_CODE = -32600;
export const MCP_JSON_RPC_OVERLIMIT_MESSAGE = "mcp_json_rpc_too_large";

if (MCP_CONTINUATION_OPERATION_MAX_BYTES > MCP_JSON_RPC_MAX_BYTES
  || MCP_TOOL_ARGUMENT_MAX_BYTES > MCP_JSON_RPC_MAX_BYTES
  || ORDINARY_HTTP_JSON_MAX_BYTES >= MCP_JSON_RPC_MAX_BYTES) {
  throw new Error("MCP JSON-RPC limit is below an advertised request budget");
}

export function mcpJsonRpcOverlimitBody() {
  return {
    jsonrpc: "2.0",
    error: {
      code: MCP_JSON_RPC_OVERLIMIT_CODE,
      message: MCP_JSON_RPC_OVERLIMIT_MESSAGE,
      data: { maxBytes: MCP_JSON_RPC_MAX_BYTES },
    },
    id: null,
  };
}
