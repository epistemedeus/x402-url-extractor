"""Paid-shape tools/call must hit the fake facilitator HTTP runtime, not a stub."""

import asyncio

from mcp import Client

from hg03_mcp_native_python.consumer import call_classified
from hg03_mcp_native_python.envelopes import local_fake_payment
from hg03_mcp_native_python.facilitator import LocalFacilitatorServer
from hg03_mcp_native_python.local_runtime import create_mcp_server
from hg03_mcp_native_python.outcomes import PAID_SHAPE, PAYMENT_REQUIRED
from hg03_mcp_native_python.payment import HttpFacilitatorClient


def test_paid_shape_goes_through_http_facilitator():
    server = LocalFacilitatorServer()
    server.serve_background()
    try:
        http_client = HttpFacilitatorClient(server.base_url, timeout_s=5.0)
        mcp = create_mcp_server(http_client)

        async def run():
            async with Client(mcp) as client:
                unpaid = await call_classified(
                    client,
                    "opportunity_preflight",
                    {"rewardUsd": 10, "hours": 1, "hourlyCostUsd": 50},
                )
                assert unpaid.kind == PAYMENT_REQUIRED
                paid = await call_classified(
                    client,
                    "opportunity_preflight",
                    {
                        "rewardUsd": 50,
                        "hours": 1,
                        "hourlyCostUsd": 5,
                        "selectionProbabilityPct": 80,
                        "agentAccess": "agent_allowed",
                        "acceptance": "deterministic",
                        "settlement": "direct",
                    },
                    meta={"x402/payment": local_fake_payment("opportunity_preflight", "50000")},
                )
                assert paid.kind == PAID_SHAPE
                assert paid.structured["spend"] is False
                assert paid.structured["localSettlement"]["transaction"] == "local-fake:no-spend"

        asyncio.run(run())
        assert server.runtime.verify_count >= 1
        assert server.runtime.settle_count >= 1
        assert server.runtime.rejected_count == 0
    finally:
        server.close()
