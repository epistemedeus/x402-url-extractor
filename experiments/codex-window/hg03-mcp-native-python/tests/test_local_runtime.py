import asyncio
from pathlib import Path

from mcp import Client

from hg03_mcp_native_python.consumer import call_classified, list_tools_unpaid
from hg03_mcp_native_python.envelopes import DISCOVERY_PREFLIGHT_TOOLS, ENVELOPES, LOCAL_ORIGIN, local_fake_payment
from hg03_mcp_native_python.facilitator import FacilitatorRuntime
from hg03_mcp_native_python.lockfile_input import construct_lockfile_arguments
from hg03_mcp_native_python.local_runtime import create_mcp_server
from hg03_mcp_native_python.outcomes import INPUT_REFUSED, PAID_SHAPE, PAYMENT_INVALID, PAYMENT_REQUIRED

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_local_tools_list_matches_discovery_and_lockfile():
    async def run():
        server = create_mcp_server(FacilitatorRuntime())
        async with Client(server) as client:
            tools = await list_tools_unpaid(client)
            names = {tool.name for tool in tools}
            for name in (*DISCOVERY_PREFLIGHT_TOOLS, "lockfile_pin_delta"):
                assert name in names
            lockfile = next(tool for tool in tools if tool.name == "lockfile_pin_delta")
            schema = lockfile.input_schema
            assert schema["required"] == ["before", "after"]
            assert schema["properties"]["before"]["type"] == "object"
            assert schema["properties"]["after"]["type"] == "object"
            x402 = (lockfile.meta or {}).get("x402") or {}
            assert x402.get("paymentRequired") is True

    asyncio.run(run())


def test_unpaid_then_local_paid_shape_opportunity_and_lockfile():
    async def run():
        runtime = FacilitatorRuntime()
        server = create_mcp_server(runtime)
        async with Client(server) as client:
            unpaid = await call_classified(
                client,
                "opportunity_preflight",
                {"rewardUsd": 10, "hours": 1, "hourlyCostUsd": 50},
            )
            assert unpaid.kind == PAYMENT_REQUIRED
            assert unpaid.charged is False
            paid = await call_classified(
                client,
                "opportunity_preflight",
                {
                    "rewardUsd": 100,
                    "hours": 1,
                    "hourlyCostUsd": 10,
                    "selectionProbabilityPct": 90,
                    "agentAccess": "agent_allowed",
                    "acceptance": "deterministic",
                    "settlement": "direct",
                },
                meta={"x402/payment": local_fake_payment("opportunity_preflight", "50000")},
            )
            assert paid.kind == PAID_SHAPE
            assert paid.structured["decision"] == "attempt"
            assert paid.structured["spend"] is False
            assert paid.structured["localSettlement"]["transaction"] == "local-fake:no-spend"
            args = construct_lockfile_arguments(FIXTURES / "lockfile-before.json", FIXTURES / "lockfile-after.json")
            lock_unpaid = await call_classified(client, "lockfile_pin_delta", args)
            assert lock_unpaid.kind == PAYMENT_REQUIRED
            lock_paid = await call_classified(
                client,
                "lockfile_pin_delta",
                args,
                meta={"x402/payment": local_fake_payment("lockfile_pin_delta", ENVELOPES["lockfile_pin_delta"].amount_atomic)},
            )
            assert lock_paid.kind == PAID_SHAPE
            assert lock_paid.structured["analysis"]["identical"] is False
            assert lock_paid.structured["charged"] is True
            assert lock_paid.structured["spend"] is False
            assert runtime.verify_count >= 2
            assert runtime.settle_count >= 2

    asyncio.run(run())


def test_lockfile_path_refused_before_facilitator():
    async def run():
        runtime = FacilitatorRuntime()
        server = create_mcp_server(runtime)
        async with Client(server) as client:
            outcome = await call_classified(
                client,
                "lockfile_pin_delta",
                {"before": "./package-lock.json", "after": "../secrets.json"},
            )
            # Schema may reject a string before the handler; handler would refuse as input.
            assert outcome.kind in {INPUT_REFUSED, "malformed_json", "malformed_tool_output"}
            assert outcome.charged is not True
            assert runtime.verify_count == 0
            assert runtime.settle_count == 0

    asyncio.run(run())


def test_invalid_local_payment_does_not_run_handler():
    async def run():
        runtime = FacilitatorRuntime()
        server = create_mcp_server(runtime)
        async with Client(server) as client:
            outcome = await call_classified(
                client,
                "opportunity_preflight",
                {"rewardUsd": 10, "hours": 1, "hourlyCostUsd": 50},
                meta={"x402/payment": {"x402Version": 2, "payload": {"kind": "real", "spend": True}}},
            )
            assert outcome.kind == PAYMENT_INVALID
            assert outcome.charged is False
            assert runtime.settle_count == 0

    asyncio.run(run())


def test_surface_budget_local_origin():
    async def run():
        server = create_mcp_server(FacilitatorRuntime())
        async with Client(server) as client:
            paid = await call_classified(
                client,
                "agent_surface_budget_audit",
                {"origin": LOCAL_ORIGIN},
                meta={"x402/payment": local_fake_payment("agent_surface_budget_audit", "10000")},
            )
            assert paid.kind == PAID_SHAPE
            assert paid.structured["mcp"]["toolCount"] == 7

    asyncio.run(run())
