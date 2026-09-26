/** Immutable W7 pins. This example does not install CrewAI; it speaks the MCP wire. */

export const CREWAI_PIN = "1.15.22";
export const CREWAI_TOOLS_PIN = "1.15.22";
export const CREWAI_LICENSE = "MIT";
export const CREWAI_DOCS_MCP = "https://docs.crewai.com/en/mcp/overview.md";
export const CREWAI_DOCS_STREAMABLE = "https://docs.crewai.com/en/mcp/streamable-http";

/** Official CrewAI APIs this example maps onto. Never Agent.kickoff(). */
export const CREWAI_TRANSPORT = "streamable-http";
export const CREWAI_DSL = "MCPServerHTTP(streamable=True)";
export const CREWAI_ADAPTER = "MCPServerAdapter(transport=streamable-http)";
export const CREWAI_CLIENT = "crewai.mcp.client.MCPClient";
export const CREWAI_SAFE_API = "MCPClient.call_tool_result";
export const CREWAI_UNSAFE_API = "MCPClient.call_tool";

export const CLIENT_INFO = Object.freeze({
  name: "crewai",
  version: CREWAI_PIN,
});

export const PROTOCOL_VERSION = "2025-03-26";

export const SDS_MCP_URL = "https://agents.samedaydesk.com/mcp";
export const NEO_LABS_CREWAI = "https://neomorphic.io/labs/crewai/";

export const TOOL_NAME = "extract";
export const TOOL_ARGUMENTS = Object.freeze({ url: "https://example.com/" });

export const FIXTURE_PAY_TO = "0x0000000000000000000000000000000000000402";
export const FIXTURE_NETWORK = "eip155:84532";
export const FIXTURE_AMOUNT = "50000";
export const FIXTURE_RESOURCE = "mcp://crewai-unpaid-call-w7/extract";
