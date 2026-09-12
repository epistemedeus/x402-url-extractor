"""Live unpaid production evidence. No payment meta, no wallet, no spend."""

import asyncio
import json
from pathlib import Path

from hg03_mcp_native_python.compare import compare_unpaid_tools
from hg03_mcp_native_python.consumer import compare_production_unpaid, production_unpaid_call
from hg03_mcp_native_python.envelopes import DISCOVERY_PREFLIGHT_TOOLS, LOCKFILE_TOOL, PRODUCTION_MCP
from hg03_mcp_native_python.outcomes import PAYMENT_REQUIRED

RECEIPT = Path(__file__).resolve().parents[1] / "receipts" / "production-unpaid-tools-list.json"


def test_snapshot_receipt_has_current_discovery_tools():
    receipt = json.loads(RECEIPT.read_text())
    assert receipt["source"] == PRODUCTION_MCP
    assert receipt["server_info_from_initialize"]["version"] == "1.23.49"
    names = set(receipt["names"])
    for name in (*DISCOVERY_PREFLIGHT_TOOLS, LOCKFILE_TOOL):
        assert name in names
    lockfile = next(row for row in receipt["tools"] if row["name"] == "lockfile_pin_delta")
    assert lockfile["input_required"] == ["before", "after"]
    assert lockfile["input_properties"] == ["after", "before"]


def test_live_unpaid_tools_list_matches_envelopes():
    report = asyncio.run(compare_production_unpaid(timeout_s=45.0))
    assert report.source == PRODUCTION_MCP
    assert report.ok, report.as_dict()["findings"]
    for name in (*DISCOVERY_PREFLIGHT_TOOLS, LOCKFILE_TOOL):
        assert name in report.matched


def test_live_unpaid_opportunity_preflight_is_payment_required():
    outcome = asyncio.run(
        production_unpaid_call(
            "opportunity_preflight",
            {"rewardUsd": 10, "hours": 1, "hourlyCostUsd": 50},
        )
    )
    assert outcome.kind == PAYMENT_REQUIRED
    assert outcome.charged is False
    assert outcome.spend is False
    assert outcome.wallet_accessed is False
    accepts = (outcome.structured or {}).get("accepts") or []
    assert accepts and accepts[0]["network"] == "eip155:8453"


def test_compare_helper_on_receipt_snapshot():
    receipt = json.loads(RECEIPT.read_text())
    # Rebuild tool-shaped dicts from the compact receipt plus envelopes file.
    envelopes = json.loads(
        (Path(__file__).resolve().parents[1] / "receipts" / "production-focus-envelopes.json").read_text()
    )
    tools = []
    for row in receipt["tools"]:
        env = envelopes.get(row["name"])
        if not env:
            tools.append(
                {
                    "name": row["name"],
                    "inputSchema": {"required": row["input_required"], "properties": {k: {} for k in row["input_properties"]}},
                    "_meta": {
                        "x402": {
                            "paymentRequired": row["x402_payment_required"],
                            "accepts": [
                                {
                                    "amount": row["amount"],
                                    "network": row["network"],
                                    "asset": row["asset"],
                                    "payTo": row["payTo"],
                                }
                            ],
                        }
                    },
                }
            )
            continue
        tools.append(
            {
                "name": env["name"],
                "inputSchema": env["inputSchema"],
                "_meta": env.get("_meta"),
            }
        )
    report = compare_unpaid_tools(tools, source="receipt")
    assert report.ok, report.as_dict()["findings"]
