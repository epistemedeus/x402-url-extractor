import json
from uuid import uuid4

import httpx
import pytest
from a2a.utils.constants import PROTOCOL_VERSION_1_0, VERSION_HEADER

from catalog_proxy import (
    DEFAULT_READINESS_URL,
    DEFAULT_UPSTREAM_URL,
    CatalogProxyExecutor,
    parse_caller_selection,
)
from main import create_app


EXAMPLE_URL = "https://agents.example/commerce/seller-integrity-audit?url=https%3A%2F%2Fexample.com"
ACTION_URL = "https://agents.example/commerce/seller-integrity-audit"
PAYMENT_HEADERS = (
    "authorization",
    "payment-signature",
    "x-payment",
    "x-payment-signature",
    "x402-payment",
)


def catalog_body():
    return {
        "message": {
            "role": "ROLE_AGENT",
            "messageId": "response-1",
            "parts": [
                {
                    "data": {
                        "actions": [
                            {
                                "serviceName": "SameDayDesk",
                                "name": "seller_integrity_audit",
                                "route": "/commerce/seller-integrity-audit",
                                "url": ACTION_URL,
                                "method": "GET",
                                "description": "Audit one seller contract.",
                                "priceAtomicUsdc": "10000",
                                "priceUsdc": 0.01,
                                "paymentProtocols": ["x402", "mpp"],
                                "request": {"exampleUrl": EXAMPLE_URL},
                            }
                        ]
                    }
                }
            ],
        }
    }


def readiness_body(*, score=45):
    return {
        "jsonrpc": "2.0",
        "id": "agentverse-a2a-free-tool",
        "result": {
            "content": [{"type": "text", "text": f"Score: {score}/100"}],
            "structuredContent": {"url": "https://example.com/", "score": score, "grade": "D"},
        },
    }


class Context:
    context_id = "owner-qa"

    def __init__(self, text):
        self._text = text

    def get_user_input(self):
        return self._text


class Queue:
    def __init__(self):
        self.events = []

    async def enqueue_event(self, event):
        self.events.append(event)


def route_transport(routes):
    seen = []

    async def handler(request: httpx.Request):
        body = json.loads(request.content) if request.content else None
        seen.append(
            {
                "url": str(request.url),
                "method": request.method,
                "headers": {k.lower(): v for k, v in request.headers.items()},
                "body": body,
            }
        )
        key = (request.method, str(request.url).split("?")[0])
        if key not in routes and ("GET", str(request.url)) not in routes:
            return httpx.Response(500, json={"missing": key})
        spec = routes.get(("GET", str(request.url)), routes.get(key))
        if spec == "redirect":
            return httpx.Response(302, headers={"location": "https://payments.example/collect"})
        if spec == "stream":
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=b"data: hi\n\n")
        if spec == "huge":
            return httpx.Response(200, content=b"x" * (128 * 1024 + 1))
        if spec == "down":
            return httpx.Response(502, text="upstream unavailable")
        if spec == "unchallenged":
            return httpx.Response(200, json={"machine_buyable": True})
        status, payload = spec
        return httpx.Response(status, json=payload)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), seen


async def run_selection(text, routes):
    client, seen = route_transport(routes)
    executor = CatalogProxyExecutor(
        upstream_url=DEFAULT_UPSTREAM_URL,
        readiness_url=DEFAULT_READINESS_URL,
        client=client,
    )
    queue = Queue()
    await executor.execute(Context(text), queue)
    await client.aclose()
    payload = json.loads(queue.events[0].parts[0].text)
    return payload, seen


def test_parse_plain_text_stays_discovery():
    assert parse_caller_selection("Find the seller-integrity audit and its exact current price.")["kind"] == "discovery"


def test_changed_tool_name_is_rejected_before_a_call():
    selected = parse_caller_selection(json.dumps({
        "kind": "free-tool",
        "tool": "check_ai_readiness_changed",
        "arguments": {"url": "https://example.com"},
    }))
    assert selected["reason"] == "unknown_tool"


def test_seeded_payment_field_is_not_a_selection():
    selected = parse_caller_selection(json.dumps({
        "kind": "paid-challenge",
        "PAYMENT-SIGNATURE": "owner-qa-seeded-not-a-signature",
    }))
    assert selected["kind"] == "paid-challenge"
    assert selected["paymentIgnored"] == ["PAYMENT-SIGNATURE"]


@pytest.mark.asyncio
async def test_native_sendmessage_returns_useful_readiness():
    client, seen = route_transport({
        ("POST", DEFAULT_READINESS_URL): (200, readiness_body()),
    })
    app = create_app(
        public_url="http://adapter.test",
        executor=CatalogProxyExecutor(client=client),
    )
    transport = httpx.ASGITransport(app=app)
    message = {
        "kind": "free-tool",
        "tool": "check_ai_readiness",
        "arguments": {"url": "https://example.com"},
        "label": "owner_qa",
    }
    async with httpx.AsyncClient(transport=transport, base_url="http://adapter.test") as http:
        response = await http.post(
            "/",
            headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
            json={
                "jsonrpc": "2.0",
                "id": "useful-1",
                "method": "SendMessage",
                "params": {
                    "message": {
                        "role": "ROLE_USER",
                        "messageId": str(uuid4()),
                        "contextId": "owner-qa",
                        "parts": [{"text": json.dumps(message)}],
                    }
                },
            },
        )
    await app.state.request_handler.aclose()
    await client.aclose()
    body = response.json()
    assert response.status_code == 200
    assert "error" not in body
    payload = json.loads(body["result"]["message"]["parts"][0]["text"])
    assert payload["kind"] == "free-tool"
    assert payload["useful"] is True
    assert payload["structuredContent"]["score"] == 45
    assert payload["cash"] == 0
    assert payload["paymentInferred"] is False
    assert seen[0]["url"] == DEFAULT_READINESS_URL
    assert seen[0]["body"]["method"] == "tools/call"
    assert seen[0]["body"]["params"]["name"] == "check_ai_readiness"
    for name in PAYMENT_HEADERS:
        assert name not in seen[0]["headers"]


@pytest.mark.asyncio
async def test_changed_and_invalid_requests_make_no_upstream_call():
    changed, seen = await run_selection(json.dumps({
        "kind": "free-tool",
        "tool": "check_ai_readiness_changed",
        "arguments": {"url": "https://example.com"},
    }), {})
    assert changed["reason"] == "unknown_tool"
    assert changed["useful"] is False
    assert seen == []
    invalid, seen = await run_selection(json.dumps({
        "kind": "free-tool",
        "tool": "check_ai_readiness",
        "arguments": {"url": "http://example.com"},
    }), {})
    assert invalid["reason"] == "invalid_request"
    assert seen == []


@pytest.mark.asyncio
async def test_paid_challenge_returns_402_and_drops_seeded_payment_header():
    payload, seen = await run_selection(json.dumps({
        "kind": "paid-challenge",
        "PAYMENT-SIGNATURE": "owner-qa-seeded-not-a-signature",
        "label": "owner_qa",
    }), {
        ("POST", DEFAULT_UPSTREAM_URL): (200, catalog_body()),
        ("GET", EXAMPLE_URL): (402, {
            "x402Version": 2,
            "error": "Payment required",
            "resource": {"url": EXAMPLE_URL, "mimeType": "application/json"},
            "accepts": [{
                "scheme": "exact",
                "network": "eip155:8453",
                "amount": "10000",
                "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "payTo": "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
            }],
        }),
    })
    assert payload["kind"] == "paid-challenge"
    assert payload["paid"] is False
    assert payload["paymentInferred"] is False
    assert payload["paymentForwarded"] is False
    assert payload["paymentIgnored"] == ["PAYMENT-SIGNATURE"]
    assert payload["challenge"]["httpStatus"] == 402
    assert payload["challenge"]["body"]["body"]["accepts"][0]["amount"] == "10000"
    assert payload["declaredSource"]["value"] == "agentverse-a2a-v1"
    assert "not attribution" in payload["declaredSource"]["boundary"]
    assert [item["method"] for item in seen] == ["POST", "GET"]
    challenge = seen[1]
    assert challenge["headers"]["x-samedaydesk-agent-source"] == "agentverse-a2a-v1"
    for name in PAYMENT_HEADERS:
        assert name not in challenge["headers"]
    assert "PAYMENT-SIGNATURE" not in json.dumps(challenge["headers"])
    assert seen[0]["body"]["message"]["parts"][0]["text"] == "List the current paid actions."


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("spec", "reason"),
    [
        ("redirect", "redirect_refused"),
        ("stream", "stream_refused"),
        ("huge", "body_budget"),
        ("down", "upstream_error"),
        ("unchallenged", "unchallenged"),
    ],
)
async def test_challenge_transport_failures_are_refused(spec, reason):
    payload, seen = await run_selection('{"kind":"paid-challenge"}', {
        ("POST", DEFAULT_UPSTREAM_URL): (200, catalog_body()),
        ("GET", EXAMPLE_URL): spec,
    })
    assert payload["kind"] == "refusal"
    assert payload["reason"] == reason
    assert payload["useful"] is False
    assert "machine_buyable" not in json.dumps(payload)
    assert len(seen) == 2
    for name in PAYMENT_HEADERS:
        assert name not in seen[1]["headers"]
