// tools/list probe for the same compare_page_observations registration the HTTP
// mount uses. This file is not a second product server.

import { setLegacyMcpToolList } from "./mcp-zod4-wire.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  PAGE_CHANGE_MCP_INSTRUCTIONS,
  PAGE_CHANGE_MCP_SERVER_NAME,
  PAGE_CHANGE_MCP_TOOL,
  pageChangeMcpToolConfig,
} from "./page-change-mcp.mjs";
import { MCP_SERVER_INPUT_LIMITS } from "./mcp-tool-input-ceiling.mjs";
import { SERVICE_VERSION } from "./service-version.mjs";

const server = new McpServer({
  name: PAGE_CHANGE_MCP_SERVER_NAME,
  version: SERVICE_VERSION,
}, {
  instructions: PAGE_CHANGE_MCP_INSTRUCTIONS,
  ...MCP_SERVER_INPUT_LIMITS,
});
const registered = server.registerTool(PAGE_CHANGE_MCP_TOOL, pageChangeMcpToolConfig(), async () => ({
  content: [{ type: "text", text: JSON.stringify({ ok: false, charged: false, error: "stdio_probe_does_not_compare" }) }],
  isError: true,
}));
setLegacyMcpToolList(server, [[PAGE_CHANGE_MCP_TOOL, registered]]);
await server.connect(new StdioServerTransport());
