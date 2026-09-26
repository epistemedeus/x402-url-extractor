"""Unpaid tools/list through CrewAI MCPServerHTTP.

Uses the same HTTP mapping CrewAI's native resolver uses for MCPServerHTTP:
HTTPTransport(url, headers, streamable) then MCPClient.list_tools(). This
module never constructs Agent, MCPNativeTool, or MCPServerAdapter, and it
never calls MCPClient.call_tool.
"""

from __future__ import annotations

import asyncio
import os
import sys
from contextlib import contextmanager
from importlib.metadata import version as pkg_version
from typing import Any

from .constants import CREWAI_PIN, EXAMPLE_VERSION, LIVE_MCP_URL, VIA
from .inventory import assert_unpaid_sds_inventory
from .policy import assert_no_tools_call, assert_unpaid_headers, assert_unpaid_mcp_server_http

_TELEMETRY_ENV = {
    "CREWAI_DISABLE_TELEMETRY": "true",
    "OTEL_SDK_DISABLED": "true",
    "ANONYMIZED_TELEMETRY": "False",
    "CREWAI_TRACING_ENABLED": "false",
}


def disable_crewai_telemetry() -> None:
    for key, value in _TELEMETRY_ENV.items():
        os.environ.setdefault(key, value)


@contextmanager
def crewai_console_to_stderr():
    """Keep JSON on stdout. CrewAI's MCP banners go to stderr."""
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = saved


def build_unpaid_mcp_server_http(
    url: str = LIVE_MCP_URL,
    *,
    allow_loopback: bool = False,
    headers: dict[str, str] | None = None,
):
    disable_crewai_telemetry()
    from crewai.mcp import MCPServerHTTP

    config = MCPServerHTTP(
        url=url,
        headers=headers,
        streamable=True,
        cache_tools_list=False,
    )
    assert_unpaid_mcp_server_http(config, allow_loopback=allow_loopback)
    return config


def _public_tool(tool: dict) -> dict[str, Any]:
    from .policy import tool_name

    name = tool_name(tool)
    description = tool.get("description") if isinstance(tool.get("description"), str) else ""
    schema = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {}
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    return {
        "name": name,
        "originalName": tool.get("original_name") or name,
        "description": description,
        "inputPropertyNames": sorted(properties.keys()),
    }


async def _list_unpaid_tools_async(config, *, allow_loopback: bool) -> dict[str, Any]:
    disable_crewai_telemetry()
    from crewai.mcp import MCPClient
    from crewai.mcp.transports.http import HTTPTransport

    assert_unpaid_mcp_server_http(config, allow_loopback=allow_loopback)
    assert_no_tools_call()
    sent_headers = assert_unpaid_headers(config.headers)

    # Same mapping as crewai.mcp.tool_resolver.MCPToolResolver._create_transport
    # for MCPServerHTTP. Discovery only: list_tools, never call_tool.
    transport = HTTPTransport(
        url=config.url,
        headers=config.headers,
        streamable=config.streamable,
    )
    client = MCPClient(
        transport=transport,
        cache_tools_list=bool(config.cache_tools_list),
        connect_timeout=30,
        discovery_timeout=30,
        max_retries=3,
    )
    with crewai_console_to_stderr():
        async with client:
            tools = await client.list_tools()
    found = assert_unpaid_sds_inventory(tools)
    installed = pkg_version("crewai")
    return {
        "ok": True,
        "mode": "unpaid_tools_list",
        "via": VIA,
        "exampleVersion": EXAMPLE_VERSION,
        "crewaiPin": CREWAI_PIN,
        "crewaiInstalled": installed,
        "url": config.url,
        "streamable": True,
        "cacheToolsList": bool(config.cache_tools_list),
        "headersSent": sent_headers,
        "paymentAttempted": False,
        "toolsCallAttempted": False,
        "toolCount": len(found["names"]),
        "required": {
            "extract": True,
            "extract_batch": True,
        },
        "tools": [_public_tool(tool) for tool in tools],
    }


def list_unpaid_tools(
    config=None,
    *,
    url: str | None = None,
    allow_loopback: bool = False,
) -> dict[str, Any]:
    """Synchronous unpaid tools/list. Default target is live SameDayDesk MCP."""
    if config is None:
        config = build_unpaid_mcp_server_http(
            url or LIVE_MCP_URL,
            allow_loopback=allow_loopback,
        )
    elif url is not None:
        raise ValueError("pass config or url, not both")
    return asyncio.run(
        _list_unpaid_tools_async(config, allow_loopback=allow_loopback)
    )
