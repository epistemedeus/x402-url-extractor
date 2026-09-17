"""Local unpaid-discovery policy. Runs before any MCP transport is opened."""

from __future__ import annotations

from ipaddress import ip_address
from urllib.parse import urlparse

from .constants import LIVE_HOST, LIVE_MCP_PATH, LOOPBACK_HOST
from .errors import PaymentRefused, PolicyError, ToolsCallRefused

FORBIDDEN_HEADER_NAMES = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "payment-signature",
        "x-payment",
        "x-payment-signature",
        "x402-payment",
        "x402/payment",
        "mcp-method",
        "www-authenticate",
        "x-api-key",
        "api-key",
    }
)

FORBIDDEN_HEADER_NEEDLES = (
    "bearer ",
    "api_key",
    "api-key",
    "private_key",
    "private-key",
    "x402/payment",
    "payment-signature",
)

FORBIDDEN_CLI_FLAGS = frozenset(
    {
        "--approve",
        "--call",
        "--pay",
        "--wallet",
        "--private-key",
        "--private-key-env",
        "--payment-signature",
        "--authorization",
    }
)


def tool_name(tool: dict) -> str:
    original = tool.get("original_name")
    if isinstance(original, str) and original:
        return original
    name = tool.get("name")
    if isinstance(name, str) and name:
        return name
    return ""


def assert_no_tools_call(*, attempted: bool = False, tool: str | None = None) -> None:
    if attempted or tool:
        suffix = f" ({tool})" if tool else ""
        raise ToolsCallRefused(
            "this example never issues MCP tools/call"
            f"{suffix}; unpaid tools/list only"
        )


def assert_no_forbidden_cli_flags(argv: list[str]) -> None:
    for arg in argv:
        name = arg.split("=", 1)[0]
        if name in FORBIDDEN_CLI_FLAGS:
            if name in {"--call"}:
                raise ToolsCallRefused(
                    f"{name} is refused: this example never issues MCP tools/call"
                )
            raise PaymentRefused(
                f"{name} is refused: unpaid tools/list sends no wallet, "
                "signature, or payment header"
            )


def _header_items(headers: dict | None) -> list[tuple[str, str]]:
    if headers is None:
        return []
    if not isinstance(headers, dict) or isinstance(headers, list):
        raise PolicyError("MCPServerHTTP.headers must be a dict of strings or None")
    items = []
    for key, value in headers.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise PolicyError("MCPServerHTTP.headers keys and values must be strings")
        items.append((key, value))
    return items


def assert_unpaid_headers(headers: dict | None) -> dict[str, str]:
    items = _header_items(headers)
    for key, value in items:
        lower = key.lower().strip()
        if lower in FORBIDDEN_HEADER_NAMES:
            raise PaymentRefused(
                f"refusing header {key!r}: unpaid tools/list sends no "
                "credentials, payment, or Mcp-Method"
            )
        blob = f"{key}:{value}".lower()
        if any(needle in blob for needle in FORBIDDEN_HEADER_NEEDLES):
            raise PaymentRefused(
                f"refusing header {key!r}: value looks like a credential or payment"
            )
    return {key: value for key, value in items}


def assert_discovery_url(raw: str, *, allow_loopback: bool = False) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise PolicyError("MCP URL is required")
    try:
        parsed = urlparse(raw)
    except Exception as exc:
        raise PolicyError("MCP URL is not a valid URL") from exc
    if parsed.username or parsed.password:
        raise PolicyError("URL credentials are refused")
    if parsed.query or parsed.fragment:
        raise PolicyError("MCP URL must not include query or fragment")
    if parsed.path != LIVE_MCP_PATH:
        raise PolicyError(f"MCP path must be exactly {LIVE_MCP_PATH}")
    host = (parsed.hostname or "").lower()
    if not host:
        raise PolicyError("MCP URL host is required")
    if ":" in host:
        raise PolicyError("IPv6 MCP URLs are refused")

    if host == LIVE_HOST:
        if parsed.scheme != "https":
            raise PolicyError("live SameDayDesk MCP is HTTPS only")
        if parsed.port not in (None, 443):
            raise PolicyError("live SameDayDesk MCP uses port 443")
        return raw

    if allow_loopback and host == LOOPBACK_HOST:
        if parsed.scheme != "http":
            raise PolicyError("loopback fixture MCP is HTTP on 127.0.0.1 only")
        if parsed.port is None or not (1 <= parsed.port <= 65535):
            raise PolicyError("loopback fixture MCP requires an explicit port")
        try:
            if ip_address(host).is_loopback is False:
                raise PolicyError("loopback fixture host is not loopback")
        except ValueError as exc:
            raise PolicyError("loopback fixture host is not a valid IP") from exc
        return raw

    raise PolicyError(
        "MCP URL must be the live SameDayDesk origin "
        "https://agents.samedaydesk.com/mcp "
        "(loopback 127.0.0.1 is allowed only for the seeded fixture)"
    )


def assert_unpaid_mcp_server_http(config, *, allow_loopback: bool = False) -> None:
    # Imported lazily so policy unit tests that only check URLs stay cheap, and
    # so CREWAI_DISABLE_TELEMETRY is set by callers before crewai loads.
    from crewai.mcp import MCPServerHTTP

    if type(config) is not MCPServerHTTP and not isinstance(config, MCPServerHTTP):
        raise PolicyError("config must be crewai.mcp.MCPServerHTTP")
    assert_discovery_url(config.url, allow_loopback=allow_loopback)
    assert_unpaid_headers(config.headers)
    if config.streamable is not True:
        raise PolicyError(
            "SameDayDesk remote MCP is streamable HTTP; MCPServerHTTP.streamable must be True"
        )
    if config.tool_filter is not None:
        raise PolicyError(
            "tool_filter is refused: unpaid discovery must not hide extract or extract_batch"
        )
