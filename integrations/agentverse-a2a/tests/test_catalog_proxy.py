import json

import httpx
import pytest

from catalog_proxy import (
    CatalogProxyError,
    CatalogProxyExecutor,
    build_upstream_request,
    extract_catalog_response,
    select_payment_integrity_action,
)


def upstream_payload(actions=None):
    return {
        "message": {
            "role": "ROLE_AGENT",
            "messageId": "response-1",
            "parts": [
                {
                    "data": {
                        "actions": actions
                        if actions is not None
                        else [
                            {
                                "serviceName": "SameDayDesk",
                                "name": "seller_integrity_audit",
                                "route": "/commerce/seller-integrity-audit",
                                "url": "https://agents.example/commerce/seller-integrity-audit",
                                "method": "GET",
                                "description": "Audit one seller contract.",
                                "priceAtomicUsdc": "10000",
                                "priceUsdc": 0.01,
                                "paymentProtocols": ["x402", "mpp"],
                                "request": {"exampleUrl": "https://agents.example/audit"},
                                "response": {"mimeType": "application/json"},
                            }
                        ]
                    }
                }
            ],
        }
    }


def test_build_upstream_request_preserves_user_text_and_context():
    request = build_upstream_request("list audits", "context-1")
    assert request["message"]["role"] == "ROLE_USER"
    assert request["message"]["contextId"] == "context-1"
    assert request["message"]["parts"] == [{"text": "list audits"}]
    assert request["message"]["messageId"]


def test_extract_catalog_response_accepts_exact_catalog():
    assert extract_catalog_response(upstream_payload())["actions"][0]["priceAtomicUsdc"] == "10000"


def test_select_payment_integrity_action_returns_a_bounded_canonical_projection():
    selected = select_payment_integrity_action(extract_catalog_response(upstream_payload()))
    assert selected["route"] == "/commerce/seller-integrity-audit"
    assert selected["priceAtomicUsdc"] == "10000"
    assert selected["exampleUrl"] == "https://agents.example/audit"
    assert selected["declaredSource"]["value"] == "agentverse-a2a-v1"
    assert "request" not in selected
    assert "response" not in selected


def test_select_payment_integrity_action_fails_when_the_route_disappears():
    with pytest.raises(CatalogProxyError, match="no seller-integrity audit"):
        select_payment_integrity_action({"actions": [{"route": "/extract"}]})


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {},
        {"message": {"role": "ROLE_USER", "parts": []}},
        {"message": {"role": "ROLE_AGENT", "parts": []}},
        {"message": {"role": "ROLE_AGENT", "parts": [{"data": []}]}},
        upstream_payload(actions=[{}] * 65),
    ],
)
def test_extract_catalog_response_rejects_invalid_shapes(payload):
    with pytest.raises(CatalogProxyError):
        extract_catalog_response(payload)


class Context:
    context_id = "context-1"

    def get_user_input(self):
        return "show payment integrity"


class Queue:
    def __init__(self):
        self.events = []

    async def enqueue_event(self, event):
        self.events.append(event)


@pytest.mark.asyncio
async def test_executor_proxies_the_canonical_catalog_without_payment():
    observed = {}

    async def handler(request):
        observed["headers"] = request.headers
        observed["body"] = json.loads(request.content)
        return httpx.Response(200, json=upstream_payload())

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    queue = Queue()
    executor = CatalogProxyExecutor(
        upstream_url="https://agents.example/a2a/message:send",
        client=client,
    )
    await executor.execute(Context(), queue)
    await client.aclose()

    assert observed["headers"]["a2a-version"] == "1.0"
    assert observed["body"]["message"]["parts"][0]["text"] == "show payment integrity"
    assert len(queue.events) == 1
    payload = json.loads(queue.events[0].parts[0].text)
    assert payload["authority"] == "agents.samedaydesk.com"
    assert payload["canonicalCatalog"] == "https://agents.samedaydesk.com/api/actions"
    assert payload["openApi"] == "https://agents.samedaydesk.com/openapi.json"
    assert payload["selectedAction"]["route"] == "/commerce/seller-integrity-audit"
    assert payload["selectedAction"]["priceAtomicUsdc"] == "10000"


@pytest.mark.asyncio
async def test_executor_fails_closed_to_the_canonical_catalog_link():
    async def handler(_request):
        return httpx.Response(200, json={"unexpected": True})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    queue = Queue()
    executor = CatalogProxyExecutor(client=client)
    await executor.execute(Context(), queue)
    await client.aclose()

    payload = json.loads(queue.events[0].parts[0].text)
    assert payload["error"] == "catalog_temporarily_unavailable"
    assert payload["canonicalCatalog"] == "https://agents.samedaydesk.com/api/actions"
