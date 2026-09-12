from hg03_mcp_native_python.outcomes import (
    MALFORMED_JSON,
    MALFORMED_TOOL_OUTPUT,
    PAYMENT_REQUIRED,
    REDIRECT,
    TIMEOUT,
    classify_tool_result,
    classify_transport_error,
)


def test_payment_required_distinct_from_malformed():
    outcome = classify_tool_result(
        tool="opportunity_preflight",
        is_error=True,
        structured={
            "x402Version": 2,
            "error": "Payment required to access this tool",
            "accepts": [{"scheme": "exact"}],
        },
        text=None,
    )
    assert outcome.kind == PAYMENT_REQUIRED
    assert outcome.charged is False


def test_malformed_json_is_not_timeout():
    outcome = classify_tool_result(
        tool="opportunity_preflight",
        is_error=True,
        structured=None,
        text="{not-json",
    )
    assert outcome.kind == MALFORMED_JSON


def test_malformed_tool_output_missing_fields():
    outcome = classify_tool_result(
        tool="opportunity_preflight",
        is_error=False,
        structured={"ok": True},
        text=None,
        required_output_fields=("ok", "product", "decision"),
    )
    assert outcome.kind == MALFORMED_TOOL_OUTPUT
    assert "product" in outcome.extra["missing"]


def test_timeout_and_redirect_stay_distinct():
    timeout = classify_transport_error(TimeoutError("deadline"))
    class RedirectRefused(Exception):
        pass
    redirect = classify_transport_error(RedirectRefused("302"))
    assert timeout.kind == TIMEOUT
    assert redirect.kind == REDIRECT
    assert timeout.kind != redirect.kind
