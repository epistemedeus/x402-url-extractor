from __future__ import annotations

import unittest

import helpers  # noqa: F401  # src on sys.path

from crewai_sds_mcp_list.errors import InventoryError
from crewai_sds_mcp_list.inventory import assert_unpaid_sds_inventory


def _tool(name: str, properties: dict) -> dict:
    return {
        "name": name,
        "original_name": name,
        "description": name,
        "inputSchema": {"type": "object", "properties": properties},
    }


EXTRACT = _tool("extract", {"url": {"type": "string"}})
BATCH = _tool("extract_batch", {"urls": {"type": "array"}, "fields": {"type": "array"}})
SCAN = _tool("scan", {"repo": {"type": "string"}})


class InventoryTest(unittest.TestCase):
    def test_required_tools_pass_with_extras(self):
        found = assert_unpaid_sds_inventory([EXTRACT, BATCH, SCAN])
        self.assertEqual(found["names"], ["extract", "extract_batch", "scan"])

    def test_missing_extract_refused(self):
        with self.assertRaises(InventoryError) as ctx:
            assert_unpaid_sds_inventory([BATCH, SCAN])
        self.assertIn("extract", str(ctx.exception))

    def test_missing_extract_batch_refused(self):
        with self.assertRaises(InventoryError) as ctx:
            assert_unpaid_sds_inventory([EXTRACT, SCAN])
        self.assertIn("extract_batch", str(ctx.exception))

    def test_duplicate_name_refused(self):
        with self.assertRaises(InventoryError):
            assert_unpaid_sds_inventory([EXTRACT, EXTRACT, BATCH])

    def test_extract_without_url_refused(self):
        bad = _tool("extract", {"site": {"type": "string"}})
        with self.assertRaises(InventoryError):
            assert_unpaid_sds_inventory([bad, BATCH])


if __name__ == "__main__":
    unittest.main()
