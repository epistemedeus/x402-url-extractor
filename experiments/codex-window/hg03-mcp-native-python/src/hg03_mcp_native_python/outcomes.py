"""Keep transport and tool-result failures distinct. Do not collapse them."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

PAYMENT_REQUIRED = "payment_required"
PAYMENT_INVALID = "payment_invalid"
PAID_SHAPE = "paid_shape"
MALFORMED_JSON = "malformed_json"
MALFORMED_TOOL_OUTPUT = "malformed_tool_output"
REDIRECT = "redirect"
TIMEOUT = "timeout"
CREDENTIAL_REFUSED = "credential_refused"
INPUT_REFUSED = "input_refused"
TRANSPORT_ERROR = "transport_error"

DISTINCT_KINDS = frozenset(
    {
        PAYMENT_REQUIRED,
        PAYMENT_INVALID,
        PAID_SHAPE,
        MALFORMED_JSON,
        MALFORMED_TOOL_OUTPUT,
        REDIRECT,
        TIMEOUT,
        CREDENTIAL_REFUSED,
        INPUT_REFUSED,
        TRANSPORT_ERROR,
    }
)


@dataclass(frozen=True)
class Outcome:
    kind: str
    message: str
    http_status: int | None = None
    tool: str | None = None
    is_error: bool | None = None
    charged: bool | None = None
    spend: bool = False
    wallet_accessed: bool = False
    structured: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "message": self.message,
            "http_status": self.http_status,
            "tool": self.tool,
            "is_error": self.is_error,
            "charged": self.charged,
            "spend": self.spend,
            "wallet_accessed": self.wallet_accessed,
            "structured": self.structured,
            "extra": self.extra,
        }


def parse_json_text(text: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        return None, f"malformed JSON: {exc.msg} at pos {exc.pos}"
    if not isinstance(value, dict) or isinstance(value, list):
        return None, "JSON root is not an object"
    return value, None


def is_payment_required_body(body: dict[str, Any] | None) -> bool:
    if not body:
        return False
    accepts = body.get("accepts")
    return (
        body.get("x402Version") == 2
        and isinstance(accepts, list)
        and len(accepts) > 0
        and isinstance(body.get("error"), str)
        and "payment required" in body["error"].lower()
    )


def is_payment_invalid_body(body: dict[str, Any] | None) -> bool:
    if not body:
        return False
    return body.get("ok") is False and body.get("error") in {
        "payment_invalid",
        "facilitator_invalid",
        "local_fake_required",
    }


def classify_tool_result(
    *,
    tool: str,
    is_error: bool,
    structured: dict[str, Any] | None,
    text: str | None,
    required_output_fields: tuple[str, ...] | None = None,
) -> Outcome:
    body = structured
    if body is None and text:
        body, err = parse_json_text(text)
        if err:
            return Outcome(
                kind=MALFORMED_JSON,
                message=err,
                tool=tool,
                is_error=is_error,
                charged=False,
                extra={"text_prefix": text[:240]},
            )
    if body is None:
        return Outcome(
            kind=MALFORMED_TOOL_OUTPUT,
            message="tool result has neither structuredContent nor JSON text",
            tool=tool,
            is_error=is_error,
            charged=False,
        )
    if is_payment_required_body(body):
        return Outcome(
            kind=PAYMENT_REQUIRED,
            message="unpaid tools/call returned an x402 payment-required envelope",
            tool=tool,
            is_error=True,
            charged=False,
            structured=body,
        )
    if is_payment_invalid_body(body):
        return Outcome(
            kind=PAYMENT_INVALID,
            message=str(body.get("error") or "payment_invalid"),
            tool=tool,
            is_error=True,
            charged=False,
            structured=body,
        )
    if body.get("error") in {"filesystem_input", "command_input", "url_input", "html-input", "parse-error"}:
        return Outcome(
            kind=INPUT_REFUSED,
            message=str(body.get("message") or body.get("error")),
            tool=tool,
            is_error=True,
            charged=False,
            structured=body,
        )
    if required_output_fields:
        missing = [field for field in required_output_fields if field.split(".")[0] not in body]
        if missing:
            return Outcome(
                kind=MALFORMED_TOOL_OUTPUT,
                message=f"paid-shape missing required fields: {', '.join(missing)}",
                tool=tool,
                is_error=is_error,
                charged=bool(body.get("charged")),
                structured=body,
                extra={"missing": missing},
            )
    return Outcome(
        kind=PAID_SHAPE,
        message="typed paid-shape result; local facilitator only, spend is false",
        tool=tool,
        is_error=False,
        charged=bool(body.get("charged")),
        spend=False,
        structured=body,
    )


def classify_transport_error(exc: BaseException) -> Outcome:
    name = type(exc).__name__
    text = str(exc)
    lowered = f"{name} {text}".lower()
    if "timeout" in lowered or name in {"TimeoutError", "ReadTimeout", "ConnectTimeout", "PoolTimeout"}:
        return Outcome(kind=TIMEOUT, message=f"timeout: {name}: {text}", charged=False)
    if "redirect" in lowered or "too many redirects" in lowered or name in {"RedirectRefused", "TooManyRedirects"}:
        return Outcome(kind=REDIRECT, message=f"redirect: {name}: {text}", charged=False)
    if hasattr(exc, "response"):
        response = getattr(exc, "response")
        status = getattr(response, "status_code", None)
        if isinstance(status, int) and 300 <= status < 400:
            return Outcome(
                kind=REDIRECT,
                message=f"HTTP {status} redirect refused",
                http_status=status,
                charged=False,
            )
    return Outcome(kind=TRANSPORT_ERROR, message=f"{name}: {text}", charged=False)
