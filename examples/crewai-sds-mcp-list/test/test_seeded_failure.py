from __future__ import annotations

import unittest

from helpers import parse_stdout_json, run_cli

from crewai.mcp import MCPServerHTTP

from crewai_sds_mcp_list.constants import VIA
from crewai_sds_mcp_list.errors import InventoryError
from crewai_sds_mcp_list.fixture_server import IncompleteMcpFixture
from crewai_sds_mcp_list.mcp_http import disable_crewai_telemetry, list_unpaid_tools


class SeededIncompleteInventoryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        disable_crewai_telemetry()

    def test_mcp_server_http_rejects_incomplete_fixture(self):
        with IncompleteMcpFixture() as fixture:
            config = MCPServerHTTP(
                url=fixture.url,
                streamable=True,
                cache_tools_list=False,
            )
            self.assertEqual(type(config).__name__, "MCPServerHTTP")
            with self.assertRaises(InventoryError) as ctx:
                list_unpaid_tools(config, allow_loopback=True)
            self.assertIn("extract", str(ctx.exception))

    def test_cli_seeded_missing_extract(self):
        result = run_cli("--seeded-failure", "missing-extract", timeout=90)
        payload = parse_stdout_json(result)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["code"], "inventory_refused")
        self.assertEqual(payload["via"], VIA)
        self.assertEqual(payload["paymentAttempted"], False)
        self.assertIn("extract", payload["error"])


if __name__ == "__main__":
    unittest.main()
