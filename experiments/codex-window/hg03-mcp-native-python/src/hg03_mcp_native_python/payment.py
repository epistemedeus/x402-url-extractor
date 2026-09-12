"""Payment gate: unpaid -> payment_required; local-fake -> facilitator verify+settle. No wallet."""

from __future__ import annotations

import json
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from mcp.types import CallToolResult, TextContent

from .envelopes import ENVELOPES, local_fake_payment, payment_required_body
from .facilitator import FacilitatorRuntime
from .wallet_guard import refuse_credentials


class FacilitatorClient(Protocol):
    def verify(self, body: dict[str, Any]) -> dict[str, Any]: ...
    def settle(self, body: dict[str, Any]) -> dict[str, Any]: ...


class InProcessFacilitatorClient:
    def __init__(self, runtime: FacilitatorRuntime) -> None:
        self.runtime = runtime

    def verify(self, body: dict[str, Any]) -> dict[str, Any]:
        return self.runtime.verify(body)

    def settle(self, body: dict[str, Any]) -> dict[str, Any]:
        return self.runtime.settle(body)


class HttpFacilitatorClient:
    def __init__(self, base_url: str, timeout_s: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        req = Request(
            f"{self.base_url}{path}",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urlopen(req, timeout=self.timeout_s) as response:
                raw = response.read()
                return json.loads(raw.decode("utf-8"))
        except HTTPError as exc:
            raw = exc.read()
            try:
                return json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as decode_err:
                raise RuntimeError(f"facilitator {path} returned malformed JSON") from decode_err
        except URLError as exc:
            raise RuntimeError(f"facilitator {path} unreachable: {exc}") from exc

    def verify(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._post("/verify", body)

    def settle(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._post("/settle", body)


def _as_result(body: dict[str, Any], *, is_error: bool) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(body, separators=(",", ":")))],
        structured_content=body,
        is_error=is_error,
    )


def payment_from_meta(meta: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(meta, dict):
        return None
    payment = meta.get("x402/payment")
    return payment if isinstance(payment, dict) else None


def gate_or_none(
    *,
    tool: str,
    meta: dict[str, Any] | None,
    arguments: dict[str, Any],
    client: FacilitatorClient,
    description: str,
) -> CallToolResult | None:
    """Return a CallToolResult to short-circuit, or None when verify+settle succeeded."""
    refuse_credentials(arguments, path=tool)
    refuse_credentials(meta or {}, path=f"{tool}._meta")
    envelope = ENVELOPES[tool]
    payment = payment_from_meta(meta)
    if payment is None:
        return _as_result(payment_required_body(tool, description, envelope.amount_atomic), is_error=True)
    body = {
        "x402Version": 2,
        "paymentPayload": payment,
        "paymentRequirements": payment.get("accepted") or local_fake_payment(tool, envelope.amount_atomic)["accepted"],
    }
    verified = client.verify(body)
    if verified.get("isValid") is not True:
        return _as_result(
            {
                "ok": False,
                "error": "payment_invalid",
                "invalidReason": verified.get("invalidReason"),
                "charged": False,
                "spend": False,
            },
            is_error=True,
        )
    settled = client.settle(body)
    if settled.get("success") is not True:
        return _as_result(
            {
                "ok": False,
                "error": "payment_invalid",
                "invalidReason": settled.get("errorReason"),
                "charged": False,
                "spend": False,
            },
            is_error=True,
        )
    # Attach settlement onto arguments via return None; caller records settlement.
    arguments["_local_settlement"] = {
        "transaction": settled.get("transaction"),
        "network": settled.get("network"),
        "spend": False,
        "success": True,
    }
    return None
