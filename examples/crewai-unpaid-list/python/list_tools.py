#!/usr/bin/env python3
"""Unpaid SameDayDesk MCP tools/list in the CrewAI streamable-http shape.

Uses the stdlib only. CrewAI MCPServerAdapter is optional and is not installed
here. This script never sends tools/call and never reads payment headers.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

EXAMPLE_ROOT = Path(__file__).resolve().parent.parent
LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp"
MCP_PROTOCOL = "2025-11-25"
CLIENT_NAME = "samedaydesk-crewai-unpaid-list"
CLIENT_VERSION = "0.1.0"
USER_AGENT = "SameDayDesk-crewai-unpaid-list/0.1.0"
REQUIRED = ("extract", "extract_batch")
DESIGNATED_SEED = EXAMPLE_ROOT / "fixtures" / "seeded" / "missing-extract.json"
TIMEOUT_S = 15
MAX_BYTES = 1_000_000
FORBIDDEN_FLAGS = ("--call", "--pay", "--approve", "--purchase", "--kickoff", "--tools-call", "--checkout")
PAYMENT_HEADERS = {
    "authorization",
    "proxy-authorization",
    "cookie",
    "x-api-key",
    "x-api-token",
    "api-key",
    "x-payment",
    "payment-signature",
    "x-payment-signature",
    "payment-required",
}


class ListError(Exception):
    def __init__(self, code: str, message: str, kind: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.kind = kind


def refuse_forbidden(argv: list[str]) -> None:
    for flag in argv:
        if flag in FORBIDDEN_FLAGS:
            raise ListError("BOUNDARY_REFUSED", f"refusing {flag}; this example never calls tools or pays", "forbidden_flag")


def parse_sse_or_json(text: str, label: str) -> Any:
    data_lines = [line[6:] for line in text.splitlines() if line.startswith("data: ")]
    raw = data_lines[-1] if data_lines else text
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ListError("TRANSPORT", f"{label} did not return JSON or JSON SSE data") from exc


def assert_list_url(value: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https"):
        raise ListError("URL_REFUSED", "mcp url must be http(s)")
    if parsed.username or parsed.password:
        raise ListError("URL_REFUSED", "mcp url must not include credentials")
    if parsed.fragment:
        raise ListError("URL_REFUSED", "mcp url must not include a fragment")
    path = parsed.path.rstrip("/") or "/"
    if path != "/mcp":
        raise ListError("URL_REFUSED", "mcp url path must be /mcp")
    host = (parsed.hostname or "").lower()
    loopback = host in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme == "http" and not loopback:
        raise ListError("URL_REFUSED", "http is only allowed for loopback test servers")
    if loopback:
        if parsed.scheme != "http":
            raise ListError("URL_REFUSED", "loopback test servers must use http")
        netloc = parsed.netloc
        return f"http://{netloc}/mcp"
    origin = f"{parsed.scheme}://{parsed.netloc}/mcp"
    if origin != LIVE_MCP_URL:
        raise ListError("URL_REFUSED", f"non-loopback mcp url must be {LIVE_MCP_URL}")
    return LIVE_MCP_URL


def accept_inventory(tools: Any) -> dict[str, Any]:
    if not isinstance(tools, list):
        raise ListError("INVENTORY_REJECT", "tools/list must return an array", "missing_tools")
    names: list[str] = []
    seen: set[str] = set()
    for tool in tools:
        name = tool.get("name") if isinstance(tool, dict) else None
        if not isinstance(name, str) or not name:
            raise ListError("INVENTORY_REJECT", "tools/list contains a missing name", "missing_name")
        if name in seen:
            raise ListError("INVENTORY_REJECT", f"tools/list duplicate name {name}", "duplicate_name")
        seen.add(name)
        names.append(name)
    for need in REQUIRED:
        if need not in seen:
            raise ListError("INVENTORY_REJECT", f"tools/list missing {need}", "missing_required")
    by_name = {tool["name"]: tool for tool in tools}
    for need in REQUIRED:
        schema = by_name[need].get("inputSchema")
        if not isinstance(schema, dict):
            raise ListError("INVENTORY_REJECT", f"{need} is missing inputSchema", "missing_schema")
    return {
        "ok": True,
        "names": names,
        "toolCount": len(names),
        "requiredPresent": {name: True for name in REQUIRED},
    }


def try_accept(tools: Any) -> dict[str, Any]:
    try:
        return accept_inventory(tools)
    except ListError as exc:
        return {"ok": False, "code": exc.code, "kind": exc.kind, "message": str(exc)}


def evaluate_recorded(seed: dict[str, Any]) -> dict[str, Any]:
    methods = seed.get("recorded", {}).get("methods") or []
    if "tools/call" in methods:
        return {
            "ok": False,
            "code": "BOUNDARY_REFUSED",
            "kind": "tools_called",
            "message": "recorded transcript includes tools/call",
        }
    headers = seed.get("recorded", {}).get("headers") or {}
    for name in headers:
        key = name.lower()
        if "payment" in key or key in PAYMENT_HEADERS or key == "mcp-method":
            return {
                "ok": False,
                "code": "BOUNDARY_REFUSED",
                "kind": "payment_header",
                "message": f"recorded request has refused header {name}",
            }
    return try_accept((seed.get("recorded") or {}).get("toolsList", {}).get("tools"))


def post_rpc(url: str, method: str, params: dict[str, Any], rpc_id: int, session_id: str | None = None) -> dict[str, Any]:
    if method == "tools/call":
        raise ListError("BOUNDARY_REFUSED", "tools/call is outside this unpaid list example", "tools_called")
    if method not in ("initialize", "tools/list"):
        raise ListError("BOUNDARY_REFUSED", f"MCP method {method} is not unpaid discovery", "method_refused")
    headers = {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        "user-agent": USER_AGENT,
    }
    if session_id:
        headers["mcp-session-id"] = session_id
    body = json.dumps({"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            raw = res.read()
            if len(raw) > MAX_BYTES:
                raise ListError("TRANSPORT", f"{method} response exceeded {MAX_BYTES} bytes")
            payload = parse_sse_or_json(raw.decode("utf-8"), method)
            return {"status": res.status, "headers": dict(res.headers.items()), "payload": payload}
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        preview = raw[:500].decode("utf-8", "replace")
        raise ListError("TRANSPORT", f"{method} HTTP {exc.code}: {preview}") from exc
    except urllib.error.URLError as exc:
        raise ListError("TRANSPORT", f"{method} failed: {exc}") from exc


def unpaid_list(url: str) -> dict[str, Any]:
    mcp_url = assert_list_url(url)
    init = post_rpc(
        mcp_url,
        "initialize",
        {
            "protocolVersion": MCP_PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": CLIENT_NAME, "version": CLIENT_VERSION},
        },
        1,
    )
    result = init["payload"].get("result") or {}
    if result.get("protocolVersion") != MCP_PROTOCOL:
        raise ListError("PROTOCOL_REFUSED", f"expected protocolVersion {MCP_PROTOCOL}")
    if (result.get("serverInfo") or {}).get("name") != "x402-data-gateway":
        raise ListError("INVENTORY_REJECT", "initialize serverInfo.name is not x402-data-gateway")
    session_id = None
    for key, value in init["headers"].items():
        if key.lower() == "mcp-session-id":
            session_id = value
            break
    listed = post_rpc(mcp_url, "tools/list", {}, 2, session_id)
    tools = (listed["payload"].get("result") or {}).get("tools")
    accepted = accept_inventory(tools)
    return {
        "ok": True,
        "command": "list",
        "mcpUrl": mcp_url,
        "transport": "streamable-http",
        "protocolVersion": result.get("protocolVersion"),
        "serverInfo": result.get("serverInfo"),
        **accepted,
        "boundary": {
            "paymentSent": False,
            "toolsCalled": False,
            "crewKickoff": False,
            "methods": ["initialize", "tools/list"],
        },
    }


def run_seeded(path: Path) -> dict[str, Any]:
    seed = json.loads(path.read_text(encoding="utf-8"))
    observed = evaluate_recorded(seed)
    judged = {
        "status": "caught" if (not observed.get("ok") and seed.get("claimedVerdict") == "accept") else "missed",
        "code": "SEED_REJECT" if not observed.get("ok") else "MISSED_SEED",
        "kind": seed.get("kind"),
        "claimedVerdict": seed.get("claimedVerdict"),
        "observedVerdict": "accept" if observed.get("ok") else "reject",
        "observedCode": observed.get("code"),
        "message": (
            f"seeded {seed.get('kind')} caught: {seed.get('id')} claimed accept, product reject ({observed.get('message')})"
            if not observed.get("ok")
            else f"seeded {seed.get('id')} was accepted; product must reject it"
        ),
    }
    return {
        "ok": False,
        "command": "seeded-failure",
        "seed": {"id": seed.get("id"), "kind": seed.get("kind"), "title": seed.get("title")},
        "observed": observed,
        "result": judged,
        "error": {"code": judged["code"], "kind": judged["kind"], "message": judged["message"]},
        "boundary": {
            "paymentSent": False,
            "toolsCalled": False,
            "crewKickoff": False,
            "methods": ["initialize", "tools/list"],
        },
    }


def main(argv: list[str]) -> int:
    refuse_forbidden(argv)
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--seeded-failure", action="store_true")
    parser.add_argument("--fixture")
    parser.add_argument("--url", default=LIVE_MCP_URL)
    args = parser.parse_args(argv)
    try:
        if args.seeded_failure:
            report = run_seeded(DESIGNATED_SEED)
            if args.json:
                print(json.dumps(report, indent=2))
            else:
                print(f"samedaydesk crewai unpaid list  fail  seeded-failure")
                print(f"  seed  {report['seed']['id']}  {report['result']['status']}")
            print(f"{report['error']['code']}: {report['error']['message']}", file=sys.stderr)
            return 2 if report["result"]["status"] == "missed" else 1
        if args.fixture:
            seed = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
            observed = evaluate_recorded(seed)
            report = {"ok": bool(observed.get("ok")), "command": "fixture", "observed": observed}
            if args.json:
                print(json.dumps(report, indent=2))
            return 0 if observed.get("ok") else 1
        report = unpaid_list(args.url)
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print("samedaydesk crewai unpaid list  pass  list")
            print(f"  mcp  {report['mcpUrl']}")
            print(f"  tools  {report['toolCount']}")
            print("  required  extract, extract_batch")
        return 0
    except ListError as exc:
        report = {"ok": False, "error": {"code": exc.code, "kind": exc.kind, "message": str(exc)}}
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(f"{exc.code}: {exc}")
        print(f"{exc.code}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
