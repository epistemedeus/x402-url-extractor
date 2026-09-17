from __future__ import annotations

import unittest

from helpers import parse_stdout_json, run_cli  # noqa: E402


class CliSeededFailureTest(unittest.TestCase):
    def test_help_lists_copyable_commands(self):
        result = run_cli("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("python bin/cli.py", result.stdout)
        self.assertIn("--seeded-failure missing-extract", result.stdout)
        self.assertIn("MCPServerHTTP", result.stdout)
        self.assertIn("never issue tools/call", result.stdout)

    def test_tools_call_flag_refused(self):
        result = run_cli("--call", "extract")
        payload = parse_stdout_json(result)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["code"], "tools_call_refused")
        self.assertEqual(payload["paymentAttempted"], False)
        self.assertEqual(payload["toolsCallAttempted"], True)

    def test_seeded_payment_header_refused(self):
        result = run_cli("--seeded-failure", "payment-header")
        payload = parse_stdout_json(result)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["code"], "payment_refused")
        self.assertEqual(payload["paymentAttempted"], False)

    def test_seeded_tools_call_refused(self):
        result = run_cli("--seeded-failure", "tools-call")
        payload = parse_stdout_json(result)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["code"], "tools_call_refused")

    def test_approve_refused_before_network(self):
        result = run_cli("--approve")
        payload = parse_stdout_json(result)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(payload["code"], "payment_refused")


if __name__ == "__main__":
    unittest.main()
