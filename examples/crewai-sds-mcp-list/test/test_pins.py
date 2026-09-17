from __future__ import annotations

import unittest
from importlib.metadata import version
from pathlib import Path

import helpers  # noqa: F401  # src on sys.path

from crewai.mcp import MCPServerHTTP

from crewai_sds_mcp_list.constants import CREWAI_PIN, LIVE_MCP_URL, MCP_PIN, VIA
from crewai_sds_mcp_list.mcp_http import disable_crewai_telemetry


class PinsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        disable_crewai_telemetry()

    def test_crewai_and_mcp_pins(self):
        self.assertEqual(version("crewai"), CREWAI_PIN)
        self.assertEqual(version("mcp"), MCP_PIN)

    def test_mcp_server_http_is_crewai_native_config(self):
        config = MCPServerHTTP(url=LIVE_MCP_URL, streamable=True)
        self.assertEqual(type(config).__name__, "MCPServerHTTP")
        self.assertEqual(config.__class__.__module__, "crewai.mcp.config")
        self.assertEqual(VIA, "crewai.mcp.MCPServerHTTP")

    def test_readme_names_the_native_class_and_live_url(self):
        readme = (Path(__file__).resolve().parents[1] / "README.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("MCPServerHTTP", readme)
        self.assertIn(LIVE_MCP_URL, readme)
        self.assertIn("tools/list", readme)
        self.assertIn("tools/call", readme)
        self.assertIn("--seeded-failure missing-extract", readme)
        self.assertIn("No `Mcp-Method` header", readme)


if __name__ == "__main__":
    unittest.main()
