"""Official mcp.Client consumer. No custom JSON-RPC, no wallet, no spend."""

from __future__ import annotations

import json
from typing import Any

import httpx
from mcp import Client
from mcp.types import TextContent

from .compare import CompareReport, compare_unpaid_tools
from .envelopes import ENVELOPES, PRODUCTION_MCP, ToolEnvelope
from .outcomes import (
    Outcome,
    REDIRECT,
    TIMEOUT,
    classify_tool_result,
    classify_transport_error,
)
from .sdk_cite import assert_official_mcp_sdk
from .wallet_guard import CredentialRefused, refuse_credentials


def _text_from_result(result: Any) -> str | None:
    content = getattr(result, "content", None) or []
    for block in content:
        if isinstance(block, TextContent):
            return block.text
        text = getattr(block, "text", None)
        if isinstance(text, str):
            return text
    return None


def _structured(result: Any) -> dict[str, Any] | None:
    value = getattr(result, "structured_content", None)
    return value if isinstance(value, dict) else None


async def list_tools_unpaid(client: Client) -> list[Any]:
    page = await client.list_tools()
    return list(page.tools)


async def call_classified(
    client: Client,
    name: str,
    arguments: dict[str, Any],
    *,
    meta: dict[str, Any] | None = None,
    read_timeout_seconds: float | None = 30.0,
) -> Outcome:
    refuse_credentials(arguments, path=name)
    if meta:
        refuse_credentials(meta, path=f"{name}._meta")
    envelope: ToolEnvelope | None = ENVELOPES.get(name)
    required = envelope.output_required if envelope else None
    try:
        result = await client.call_tool(
            name,
            arguments,
            read_timeout_seconds=read_timeout_seconds,
            meta=meta,
        )
    except CredentialRefused:
        raise
    except BaseException as exc:
        return classify_transport_error(exc)
    return classify_tool_result(
        tool=name,
        is_error=bool(getattr(result, "is_error", False)),
        structured=_structured(result),
        text=_text_from_result(result),
        required_output_fields=required if meta else None,
    )


async def compare_production_unpaid(*, mcp_url: str = PRODUCTION_MCP, timeout_s: float = 30.0) -> CompareReport:
    assert_official_mcp_sdk()
    async with Client(mcp_url, read_timeout_seconds=timeout_s) as client:
        tools = await list_tools_unpaid(client)
        return compare_unpaid_tools(tools, source=mcp_url)


def fetch_classifying_http(url: str, *, timeout_s: float = 5.0, follow_redirects: bool = False) -> Outcome:
    """HTTP helper used to keep redirect vs timeout distinct from MCP tool results."""
    try:
        with httpx.Client(timeout=timeout_s, follow_redirects=follow_redirects) as http:
            response = http.get(url)
    except httpx.TimeoutException as exc:
        return Outcome(kind=TIMEOUT, message=f"timeout: {exc}", charged=False)
    except httpx.TooManyRedirects as exc:
        return Outcome(kind=REDIRECT, message=f"redirect: {exc}", charged=False)
    except BaseException as exc:
        return classify_transport_error(exc)
    if 300 <= response.status_code < 400:
        return Outcome(
            kind=REDIRECT,
            message=f"HTTP {response.status_code} redirect refused",
            http_status=response.status_code,
            charged=False,
            extra={"location": response.headers.get("location")},
        )
    try:
        response.json()
    except json.JSONDecodeError as exc:
        from .outcomes import MALFORMED_JSON

        return Outcome(kind=MALFORMED_JSON, message=f"malformed JSON: {exc.msg}", http_status=response.status_code)
    return Outcome(
        kind="http_ok",
        message="HTTP JSON ok",
        http_status=response.status_code,
        structured=response.json() if response.headers.get("content-type", "").startswith("application/json") else None,
    )


async def production_unpaid_call(name: str, arguments: dict[str, Any], *, mcp_url: str = PRODUCTION_MCP) -> Outcome:
    """Unpaid tools/call against production. Expect payment_required. Never sends payment meta."""
    assert_official_mcp_sdk()
    refuse_credentials(arguments, path=name)
    async with Client(mcp_url, read_timeout_seconds=30.0) as client:
        return await call_classified(client, name, arguments, meta=None)
