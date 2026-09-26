#!/usr/bin/env python3
"""Copyable CrewAI host path for unpaid SameDayDesk tools/list.

CrewAI must already be installed. This file does not install crewai-tools,
create a wallet, call a tool, or kick off a crew. If MCPServerAdapter is
missing, it records that limit and exits 2.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

EXAMPLE_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = EXAMPLE_ROOT / "fixtures" / "crewai.mcp.json"
REQUIRED = ("extract", "extract_batch")
FORBIDDEN = ("--call", "--pay", "--approve", "--purchase", "--kickoff", "--tools-call")


def main(argv: list[str]) -> int:
    for flag in argv:
        if flag in FORBIDDEN:
            print(f"BOUNDARY_REFUSED: refusing {flag}", file=sys.stderr)
            return 1
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    server_params = {"url": config["url"], "transport": config["transport"]}
    try:
        from crewai_tools import MCPServerAdapter
    except ImportError:
        print("crewai_tools.MCPServerAdapter is not installed.")
        print("This directory does not install CrewAI.")
        print("Unpaid discovery without CrewAI:")
        print("  node bin/cli.mjs --json")
        print("  python3 python/list_tools.py --json")
        print(json.dumps({"adapter": server_params, "stop": "list tools only"}, indent=2))
        return 2

    with MCPServerAdapter(server_params) as tools:
        names = [tool.name for tool in tools]
        missing = [name for name in REQUIRED if name not in names]
        print(json.dumps({
            "adapter": server_params,
            "toolCount": len(names),
            "names": names,
            "requiredPresent": {name: name in names for name in REQUIRED},
            "toolsCalled": False,
            "crewKickoff": False,
        }, indent=2))
        if missing:
            print(f"INVENTORY_REJECT: tools/list missing {', '.join(missing)}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
