from hg03_mcp_native_python.sdk_cite import OFFICIAL_MCP_VERSION, assert_official_mcp_sdk


def test_official_mcp_sdk_is_installed():
    identity = assert_official_mcp_sdk()
    assert identity["package"] == "mcp"
    assert identity["version"] == OFFICIAL_MCP_VERSION == "2.2.0"
    assert identity["client_module"].startswith("mcp.")
    assert identity["server_module"].startswith("mcp.")
    assert "jsonrpc" not in identity["client_module"]
