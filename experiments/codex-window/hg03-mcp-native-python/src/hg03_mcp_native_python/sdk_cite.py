"""Cite the installed official MCP Python SDK. Refuse a hand-rolled JSON-RPC stand-in."""

from __future__ import annotations

import importlib.metadata
from pathlib import Path

OFFICIAL_MCP_VERSION = "2.2.0"
OFFICIAL_PACKAGE = "mcp"
OFFICIAL_CLIENT_IMPORT = "mcp.Client"
PYPI_JSON = "https://pypi.org/pypi/mcp/2.2.0/json"
DOCS = "https://py.sdk.modelcontextprotocol.io/"
REPO = "https://github.com/modelcontextprotocol/python-sdk"


class SdkCiteError(RuntimeError):
    """Installed package is not the cited official MCP SDK."""


def sdk_identity() -> dict[str, str]:
    dist = importlib.metadata.distribution(OFFICIAL_PACKAGE)
    version = dist.version
    loc = Path(dist.locate_file(""))
    return {
        "package": OFFICIAL_PACKAGE,
        "version": version,
        "location": str(loc),
        "pypi_json": PYPI_JSON,
        "documentation": DOCS,
        "repository": REPO,
        "client_import": OFFICIAL_CLIENT_IMPORT,
    }


def assert_official_mcp_sdk() -> dict[str, str]:
    identity = sdk_identity()
    if identity["version"] != OFFICIAL_MCP_VERSION:
        raise SdkCiteError(
            f"expected {OFFICIAL_PACKAGE}=={OFFICIAL_MCP_VERSION}, found {identity['version']}"
        )
    from mcp import Client
    from mcp.server import MCPServer

    client_mod = getattr(Client, "__module__", "")
    server_mod = getattr(MCPServer, "__module__", "")
    if not client_mod.startswith("mcp."):
        raise SdkCiteError(f"Client is not from mcp.* ({client_mod})")
    if not server_mod.startswith("mcp."):
        raise SdkCiteError(f"MCPServer is not from mcp.* ({server_mod})")
    identity["client_module"] = client_mod
    identity["server_module"] = server_mod
    return identity
