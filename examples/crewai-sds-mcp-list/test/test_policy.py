from __future__ import annotations

import unittest

import helpers  # noqa: F401  # src on sys.path

from crewai_sds_mcp_list.constants import LIVE_MCP_URL
from crewai_sds_mcp_list.errors import PaymentRefused, PolicyError, ToolsCallRefused
from crewai_sds_mcp_list.mcp_http import disable_crewai_telemetry
from crewai_sds_mcp_list.policy import (
    assert_discovery_url,
    assert_no_forbidden_cli_flags,
    assert_no_tools_call,
    assert_unpaid_headers,
    assert_unpaid_mcp_server_http,
)


class UrlPolicyTest(unittest.TestCase):
    def test_live_url_accepted(self):
        self.assertEqual(assert_discovery_url(LIVE_MCP_URL), LIVE_MCP_URL)

    def test_http_live_refused(self):
        with self.assertRaises(PolicyError):
            assert_discovery_url("http://agents.samedaydesk.com/mcp")

    def test_credentials_refused(self):
        with self.assertRaises(PolicyError):
            assert_discovery_url("https://user:pass@agents.samedaydesk.com/mcp")

    def test_query_refused(self):
        with self.assertRaises(PolicyError):
            assert_discovery_url(LIVE_MCP_URL + "?api_key=1")

    def test_wrong_path_refused(self):
        with self.assertRaises(PolicyError):
            assert_discovery_url("https://agents.samedaydesk.com/sse")

    def test_other_origin_refused(self):
        with self.assertRaises(PolicyError):
            assert_discovery_url("https://example.com/mcp")

    def test_loopback_requires_flag_and_port(self):
        with self.assertRaises(PolicyError):
            assert_discovery_url("http://127.0.0.1:9/mcp")
        self.assertEqual(
            assert_discovery_url("http://127.0.0.1:9/mcp", allow_loopback=True),
            "http://127.0.0.1:9/mcp",
        )
        with self.assertRaises(PolicyError):
            assert_discovery_url("http://localhost:9/mcp", allow_loopback=True)


class HeaderAndCallPolicyTest(unittest.TestCase):
    def test_empty_headers_ok(self):
        self.assertEqual(assert_unpaid_headers(None), {})
        self.assertEqual(assert_unpaid_headers({}), {})

    def test_payment_signature_refused(self):
        with self.assertRaises(PaymentRefused):
            assert_unpaid_headers({"PAYMENT-SIGNATURE": "seeded"})

    def test_authorization_refused(self):
        with self.assertRaises(PaymentRefused):
            assert_unpaid_headers({"Authorization": "Bearer seeded"})

    def test_mcp_method_refused(self):
        with self.assertRaises(PaymentRefused):
            assert_unpaid_headers({"Mcp-Method": "tools/list"})

    def test_tools_call_refused(self):
        with self.assertRaises(ToolsCallRefused):
            assert_no_tools_call(attempted=True, tool="extract")

    def test_forbidden_cli_flags(self):
        with self.assertRaises(ToolsCallRefused):
            assert_no_forbidden_cli_flags(["--call", "extract"])
        with self.assertRaises(PaymentRefused):
            assert_no_forbidden_cli_flags(["--approve"])
        with self.assertRaises(PaymentRefused):
            assert_no_forbidden_cli_flags(["--private-key-env", "X"])


class McpServerHttpPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        disable_crewai_telemetry()

    def test_streamable_false_refused(self):
        from crewai.mcp import MCPServerHTTP

        config = MCPServerHTTP(url=LIVE_MCP_URL, streamable=False)
        with self.assertRaises(PolicyError):
            assert_unpaid_mcp_server_http(config)

    def test_default_config_ok(self):
        from crewai.mcp import MCPServerHTTP

        config = MCPServerHTTP(url=LIVE_MCP_URL, streamable=True)
        assert_unpaid_mcp_server_http(config)


if __name__ == "__main__":
    unittest.main()
