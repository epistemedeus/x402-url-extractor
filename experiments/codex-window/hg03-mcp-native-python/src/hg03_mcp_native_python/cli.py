"""CLI for the official MCP SDK consumer and local fake facilitator."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .envelopes import ENVELOPES, LOCAL_FAKE_RESOURCE, LOCAL_ORIGIN, PRODUCTION_MCP, local_fake_payment
from .lockfile_input import construct_lockfile_arguments
from .sdk_cite import assert_official_mcp_sdk
from .wallet_guard import handler_reads_no_wallet_env


def _print(value: object) -> None:
    json.dump(value, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")


def cmd_cite(_args: argparse.Namespace) -> int:
    identity = assert_official_mcp_sdk()
    identity["unread_wallet_env"] = list(handler_reads_no_wallet_env())
    _print(identity)
    return 0


def cmd_construct_lockfile(args: argparse.Namespace) -> int:
    arguments = construct_lockfile_arguments(args.before, args.after)
    _print(
        {
            "tool": "lockfile_pin_delta",
            "arguments_are_objects": True,
            "before_keys": sorted(arguments["before"]),
            "after_keys": sorted(arguments["after"]),
            "before_lockfileVersion": arguments["before"].get("lockfileVersion"),
            "after_lockfileVersion": arguments["after"].get("lockfileVersion"),
            "paths_echoed": False,
            "before_path": str(args.before),
            "after_path": str(args.after),
            "note": "MCP arguments are the objects only. Paths stay local.",
        }
    )
    return 0


def cmd_compare_production(_args: argparse.Namespace) -> int:
    from .consumer import compare_production_unpaid

    report = asyncio.run(compare_production_unpaid())
    _print(report.as_dict())
    return 0 if report.ok else 2


def cmd_recipe(args: argparse.Namespace) -> int:
    from mcp import Client

    from .consumer import call_classified, list_tools_unpaid
    from .facilitator import FacilitatorRuntime
    from .local_runtime import create_mcp_server

    identity = assert_official_mcp_sdk()
    runtime = FacilitatorRuntime()
    server = create_mcp_server(runtime)

    async def run() -> dict:
        async with Client(server) as client:
            tools = await list_tools_unpaid(client)
            names = [tool.name for tool in tools]
            unpaid = await call_classified(
                client,
                "opportunity_preflight",
                {"rewardUsd": 10, "hours": 1, "hourlyCostUsd": 50},
            )
            paid = await call_classified(
                client,
                "opportunity_preflight",
                {
                    "rewardUsd": 100,
                    "hours": 1,
                    "hourlyCostUsd": 20,
                    "selectionProbabilityPct": 80,
                    "agentAccess": "agent_allowed",
                    "acceptance": "deterministic",
                    "settlement": "direct",
                },
                meta={"x402/payment": local_fake_payment("opportunity_preflight", "50000")},
            )
            lockfile_args = construct_lockfile_arguments(args.before, args.after)
            lockfile_unpaid = await call_classified(client, "lockfile_pin_delta", lockfile_args)
            lockfile_paid = await call_classified(
                client,
                "lockfile_pin_delta",
                lockfile_args,
                meta={"x402/payment": local_fake_payment("lockfile_pin_delta", ENVELOPES["lockfile_pin_delta"].amount_atomic)},
            )
            return {
                "sdk": identity,
                "local_tools": names,
                "opportunity_unpaid": unpaid.as_dict(),
                "opportunity_paid_shape": paid.as_dict(),
                "lockfile_unpaid": lockfile_unpaid.as_dict(),
                "lockfile_paid_shape": lockfile_paid.as_dict(),
                "facilitator": {
                    "verify_count": runtime.verify_count,
                    "settle_count": runtime.settle_count,
                    "rejected_count": runtime.rejected_count,
                    "spend": False,
                },
                "wallet_accessed": False,
                "production_mcp": PRODUCTION_MCP,
                "local_origin": LOCAL_ORIGIN,
                "local_fake_resource": LOCAL_FAKE_RESOURCE,
            }

    _print(asyncio.run(run()))
    return 0


def cmd_serve_facilitator(args: argparse.Namespace) -> int:
    from .facilitator import LocalFacilitatorServer

    server = LocalFacilitatorServer(host=args.host, port=args.port)
    server.serve_background()
    print(f"local-fake facilitator on {server.base_url} (GET /supported POST /verify POST /settle)", file=sys.stderr)
    try:
        server._thread.join()
    except KeyboardInterrupt:
        server.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hg03-mcp-native-python",
        description="Official Python MCP SDK consumer for SameDayDesk discovery/preflight envelopes.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("cite", help="Print the installed official mcp SDK identity").set_defaults(func=cmd_cite)
    compare = sub.add_parser("compare-production", help="Unpaid tools/list against live production MCP")
    compare.set_defaults(func=cmd_compare_production)
    construct = sub.add_parser("construct-lockfile", help="Read local package-lock.json files into MCP objects")
    here = Path(__file__).resolve().parents[2]
    default_lock = here / "fixtures" / "lockfile-before.json"
    construct.add_argument("--before", type=Path, default=default_lock)
    construct.add_argument("--after", type=Path, default=here / "fixtures" / "lockfile-after.json")
    construct.set_defaults(func=cmd_construct_lockfile)
    recipe = sub.add_parser("recipe", help="Run the verified local unpaid then fake-paid recipe")
    recipe.add_argument("--before", type=Path, default=default_lock)
    recipe.add_argument("--after", type=Path, default=here / "fixtures" / "lockfile-after.json")
    recipe.set_defaults(func=cmd_recipe)
    serve = sub.add_parser("serve-facilitator", help="Run the local fake facilitator HTTP runtime")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=0)
    serve.set_defaults(func=cmd_serve_facilitator)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
