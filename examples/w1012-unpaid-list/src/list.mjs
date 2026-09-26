import { LIVE_MCP_URL, MCP_PROTOCOL, MCP_TRANSPORT } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { acceptInventory } from "./accept.mjs";
import { unpaidBoundary } from "./boundary.mjs";
import { loadMcpConfig } from "./config.mjs";
import { initializeParams, postRpc } from "./transport.mjs";
import { assertListUrl } from "./url-guard.mjs";

function rpcOk(exchange, method) {
  if (!exchange.response.ok) {
    fail("TRANSPORT", `${method} HTTP ${exchange.response.status}`);
  }
  if (exchange.payload?.parseError) {
    fail("TRANSPORT", `${method} was not JSON`);
  }
  if (exchange.payload?.error) {
    fail("TRANSPORT", `${method} JSON-RPC error ${JSON.stringify(exchange.payload.error).slice(0, 200)}`);
  }
  if (!exchange.payload?.result) {
    fail("TRANSPORT", `${method} missing result`);
  }
  return exchange.payload.result;
}

export async function unpaidToolsList({
  url = LIVE_MCP_URL,
  fetchImpl,
  signal,
  configPath,
} = {}) {
  const config = loadMcpConfig(configPath);
  const mcpUrl = assertListUrl(url);
  const initialize = await postRpc(mcpUrl, "initialize", initializeParams(), 1, {
    fetchImpl,
    signal,
  });
  const initResult = rpcOk(initialize, "initialize");
  if (initResult.protocolVersion !== MCP_PROTOCOL) {
    fail("PROTOCOL_REFUSED", `expected protocolVersion ${MCP_PROTOCOL}, got ${initResult.protocolVersion}`);
  }
  if (initResult.serverInfo?.name !== "x402-data-gateway") {
    fail("INVENTORY_REJECT", "initialize serverInfo.name is not x402-data-gateway");
  }
  const sessionId = initialize.response.headers.get("mcp-session-id");
  const listed = await postRpc(mcpUrl, "tools/list", {}, 2, {
    fetchImpl,
    signal,
    sessionId: sessionId || undefined,
  });
  const listResult = rpcOk(listed, "tools/list");
  const accepted = acceptInventory(listResult.tools);
  return {
    ok: true,
    command: "list",
    mcpUrl,
    transport: MCP_TRANSPORT,
    config: { url: config.url, transport: config.transport },
    protocolVersion: initResult.protocolVersion,
    serverInfo: initResult.serverInfo,
    sessionIdPresent: Boolean(sessionId),
    ...accepted,
    boundary: unpaidBoundary(),
  };
}
