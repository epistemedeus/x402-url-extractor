"""SameDayDesk + CrewAI pins for unpaid MCP tools/list."""

EXAMPLE_VERSION = "0.1.0"
CREWAI_PIN = "1.15.22"
MCP_PIN = "1.28.1"
LIVE_ORIGIN = "https://agents.samedaydesk.com"
LIVE_MCP_PATH = "/mcp"
LIVE_MCP_URL = f"{LIVE_ORIGIN}{LIVE_MCP_PATH}"
LIVE_HOST = "agents.samedaydesk.com"
REQUIRED_TOOLS = ("extract", "extract_batch")
MAX_TOOL_COUNT = 100
VIA = "crewai.mcp.MCPServerHTTP"
LOOPBACK_HOST = "127.0.0.1"
