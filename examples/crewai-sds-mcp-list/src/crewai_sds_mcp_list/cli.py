"""Copyable unpaid tools/list CLI. Default is live SameDayDesk MCP."""

from __future__ import annotations

import argparse
import json
import sys

from .constants import CREWAI_PIN, LIVE_MCP_URL, MCP_PIN, VIA
from .errors import ExampleError, PaymentRefused, ToolsCallRefused
from .mcp_http import (
    build_unpaid_mcp_server_http,
    disable_crewai_telemetry,
    list_unpaid_tools,
)
from .policy import assert_no_forbidden_cli_flags, assert_no_tools_call

SEEDED_FAILURES = ("missing-extract", "tools-call", "payment-header")


def usage_text() -> str:
    return f"""SameDayDesk CrewAI unpaid tools/list

Credential-free discovery only. Uses CrewAI `{VIA}` against the live
SameDayDesk streamable-HTTP MCP URL. Default commands never read a wallet,
never send payment headers, and never issue tools/call.

Cold unpaid tools/list (live merchant):
  python bin/cli.py
  python bin/cli.py --url {LIVE_MCP_URL}

Seeded failures this example rejects:
  python bin/cli.py --seeded-failure missing-extract
  python bin/cli.py --seeded-failure tools-call
  python bin/cli.py --seeded-failure payment-header

Pins:
  crewai  {CREWAI_PIN}
  mcp     {MCP_PIN} (CrewAI 1.15.22 requires mcp~=1.28.1)
  url     {LIVE_MCP_URL}

Notes:
  - tools/list is free protocol discovery. tools/call is paid and is not
    implemented here.
  - This is not an Agent, Crew, wallet, MCPServerAdapter, or Goose/Claude plugin.
  - Extra live tools besides extract and extract_batch are accepted.
  - Loopback 127.0.0.1 is only for the seeded incomplete fixture.
  - Do not send Mcp-Method. Do not claim MCP 2026-07-28 support.
"""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    raw = list(sys.argv[1:] if argv is None else argv)
    if "-h" in raw or "--help" in raw:
        namespace = argparse.Namespace(help=True, url=None, seeded_failure=None)
        return namespace
    assert_no_forbidden_cli_flags(raw)
    parser = argparse.ArgumentParser(
        prog="samedaydesk-crewai-sds-mcp-list",
        description="CrewAI MCPServerHTTP unpaid SameDayDesk tools/list",
        add_help=False,
    )
    parser.add_argument("--url", default=None)
    parser.add_argument("--seeded-failure", choices=SEEDED_FAILURES, default=None)
    try:
        parsed = parser.parse_args(raw)
    except SystemExit as exc:
        from .errors import PolicyError

        raise PolicyError("unknown or invalid argument") from exc
    parsed.help = False
    return parsed


def _print_json(payload: dict, *, exit_code: int) -> int:
    sys.stdout.write(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    return exit_code


def _error_payload(exc: BaseException) -> dict:
    code = getattr(exc, "code", "error")
    return {
        "ok": False,
        "error": str(exc),
        "code": code,
        "via": VIA,
        "paymentAttempted": False,
        "toolsCallAttempted": code == "tools_call_refused",
    }


def _run_seeded_failure(kind: str) -> int:
    if kind == "tools-call":
        assert_no_tools_call(attempted=True, tool="extract")
    if kind == "payment-header":
        build_unpaid_mcp_server_http(
            LIVE_MCP_URL,
            headers={"PAYMENT-SIGNATURE": "seeded-not-a-credential"},
        )
        raise PaymentRefused("payment header was not refused")
    if kind == "missing-extract":
        from .fixture_server import IncompleteMcpFixture

        with IncompleteMcpFixture() as fixture:
            list_unpaid_tools(url=fixture.url, allow_loopback=True)
        raise ExampleError("seeded incomplete inventory was not refused")
    raise ExampleError(f"unknown seeded failure: {kind}")


def main(argv: list[str] | None = None) -> int:
    disable_crewai_telemetry()
    try:
        args = parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return 0 if code in (0, None) else int(code)
    except ExampleError as exc:
        return _print_json(_error_payload(exc), exit_code=exc.exit_code)

    if getattr(args, "help", False):
        sys.stdout.write(usage_text())
        return 0

    if args.seeded_failure:
        try:
            return _run_seeded_failure(args.seeded_failure)
        except ExampleError as exc:
            return _print_json(_error_payload(exc), exit_code=exc.exit_code)
        except Exception as exc:
            return _print_json(_error_payload(exc), exit_code=1)

    try:
        report = list_unpaid_tools(
            url=args.url or LIVE_MCP_URL,
            allow_loopback=False,
        )
        return _print_json(report, exit_code=0)
    except ExampleError as exc:
        return _print_json(_error_payload(exc), exit_code=exc.exit_code)
    except Exception as exc:
        return _print_json(_error_payload(exc), exit_code=1)


if __name__ == "__main__":
    raise SystemExit(main())
