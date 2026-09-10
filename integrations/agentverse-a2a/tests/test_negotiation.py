import asyncio
import json
import socket
from uuid import uuid4

import httpx
import pytest
import uvicorn
from a2a.client import ClientConfig, ClientFactory
from a2a.client.transports.jsonrpc import JsonRpcTransport
from a2a.server.request_handlers.response_helpers import agent_card_to_dict
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    Message,
    Part,
    Role,
    SendMessageRequest,
)
from a2a.utils.constants import (
    AGENT_CARD_WELL_KNOWN_PATH,
    PROTOCOL_VERSION_0_3,
    PROTOCOL_VERSION_1_0,
    VERSION_HEADER,
)
from a2a.utils.errors import JSON_RPC_ERROR_CODE_MAP, VersionNotSupportedError

from catalog_proxy import DEFAULT_UPSTREAM_URL, CatalogProxyExecutor
from main import build_agent_card, create_app


PAYMENT_HEADERS = (
    "authorization",
    "x-payment",
    "x-payment-signature",
    "payment-signature",
    "x402-payment",
)

CATALOG_PRICE = "42424"
CATALOG_ROUTE = "/commerce/seller-integrity-audit"
EXAMPLE_URL = "https://agents.example/commerce/seller-integrity-audit?url=https%3A%2F%2Fexample.com"
PUBLIC_URL = "http://adapter.test"


def catalog_upstream_payload(*, price=CATALOG_PRICE, route=CATALOG_ROUTE):
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
                                "route": route,
                                "url": "https://agents.example/commerce/seller-integrity-audit",
                                "method": "GET",
                                "description": "Audit one seller contract.",
                                "priceAtomicUsdc": price,
                                "priceUsdc": 0.042424,
                                "paymentProtocols": ["x402", "mpp"],
                                "request": {"exampleUrl": EXAMPLE_URL},
                            }
                        ]
                    }
                }
            ],
        }
    }


def send_message_params(text="Find the seller-integrity audit and its exact current price."):
    return {
        "message": {
            "role": "ROLE_USER",
            "messageId": str(uuid4()),
            "contextId": str(uuid4()),
            "parts": [{"text": text}],
        }
    }


class UpstreamState:
    def __init__(self):
        self.mode = "ok"
        self.requests = []
        self.price = CATALOG_PRICE
        self.route = CATALOG_ROUTE


def make_executor(state: UpstreamState):
    async def handler(request: httpx.Request):
        body = json.loads(request.content) if request.content else None
        state.requests.append(
            {
                "url": str(request.url),
                "method": request.method,
                "headers": {k.lower(): v for k, v in request.headers.items()},
                "body": body,
            }
        )
        if state.mode == "http_error":
            return httpx.Response(502, text="upstream unavailable")
        if state.mode == "invalid_shape":
            return httpx.Response(200, json={"unexpected": True})
        return httpx.Response(
            200,
            json=catalog_upstream_payload(price=state.price, route=state.route),
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    executor = CatalogProxyExecutor(upstream_url=DEFAULT_UPSTREAM_URL, client=client)
    return executor, client


@pytest.fixture
async def adapter():
    state = UpstreamState()
    executor, upstream_client = make_executor(state)
    app = create_app(public_url=PUBLIC_URL, executor=executor)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=PUBLIC_URL) as client:
        yield {
            "app": app,
            "client": client,
            "state": state,
        }
        await app.state.request_handler.aclose()
        await upstream_client.aclose()


def unused_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
async def live_server():
    port = unused_port()
    public_url = f"http://127.0.0.1:{port}"
    state = UpstreamState()
    executor, upstream_client = make_executor(state)
    app = create_app(public_url=public_url, executor=executor)
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="error",
        lifespan="off",
        access_log=False,
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    try:
        for _ in range(200):
            if server.started:
                break
            await asyncio.sleep(0.01)
        else:
            raise RuntimeError("disposable A2A server failed to start")
        yield {"url": public_url, "app": app, "state": state}
    finally:
        server.should_exit = True
        await task
        await app.state.request_handler.aclose()
        await upstream_client.aclose()


def test_sdk_injects_0_3_when_interface_protocol_version_is_unset():
    card = AgentCard(
        name="unset",
        description="unset",
        supported_interfaces=[
            AgentInterface(protocol_binding="JSONRPC", url="http://example.test"),
        ],
        version="0.1.0",
        default_input_modes=["text"],
        default_output_modes=["text"],
        capabilities=AgentCapabilities(streaming=False),
    )
    dumped = agent_card_to_dict(card)
    assert dumped["protocolVersion"] == PROTOCOL_VERSION_0_3
    assert dumped["preferredTransport"] == "JSONRPC"
    assert dumped["url"] == "http://example.test"


def test_agent_card_advertises_jsonrpc_1_0_and_not_legacy_0_3():
    dumped = agent_card_to_dict(build_agent_card(PUBLIC_URL))
    assert dumped["supportedInterfaces"] == [
        {
            "url": PUBLIC_URL,
            "protocolBinding": "JSONRPC",
            "protocolVersion": PROTOCOL_VERSION_1_0,
        }
    ]
    assert dumped.get("protocolVersion") != PROTOCOL_VERSION_0_3
    assert "protocolVersion" not in dumped
    assert "preferredTransport" not in dumped
    assert "url" not in dumped


@pytest.mark.asyncio
async def test_well_known_card_matches_jsonrpc_1_0_and_advertised_path(adapter):
    response = await adapter["client"].get(AGENT_CARD_WELL_KNOWN_PATH)
    assert response.status_code == 200
    card = response.json()
    interface = card["supportedInterfaces"][0]
    assert interface["protocolBinding"] == "JSONRPC"
    assert interface["protocolVersion"] == PROTOCOL_VERSION_1_0
    assert interface["url"] == PUBLIC_URL
    assert card.get("protocolVersion") != PROTOCOL_VERSION_0_3
    assert "protocolVersion" not in card


@pytest.mark.asyncio
async def test_supported_version_sendmessage_returns_exact_catalog_price_and_route(adapter):
    response = await adapter["client"].post(
        "/",
        headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
        json={
            "jsonrpc": "2.0",
            "id": "catalog-1",
            "method": "SendMessage",
            "params": send_message_params(),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == "catalog-1"
    assert "error" not in body
    text = body["result"]["message"]["parts"][0]["text"]
    payload = json.loads(text)
    assert payload["selectedAction"]["route"] == CATALOG_ROUTE
    assert payload["selectedAction"]["priceAtomicUsdc"] == CATALOG_PRICE
    assert payload["selectedAction"]["exampleUrl"] == EXAMPLE_URL
    assert payload["canonicalCatalog"] == "https://agents.samedaydesk.com/api/actions"
    assert "authorize payment only within your own policy" in payload["instruction"]


@pytest.mark.parametrize("version", [PROTOCOL_VERSION_0_3, None])
@pytest.mark.asyncio
async def test_unsupported_or_missing_version_returns_jsonrpc_error_envelope(adapter, version):
    headers = {}
    if version is not None:
        headers[VERSION_HEADER] = version
    response = await adapter["client"].post(
        "/",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": "version-1",
            "method": "SendMessage",
            "params": send_message_params(),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == "version-1"
    assert body["error"]["code"] == JSON_RPC_ERROR_CODE_MAP[VersionNotSupportedError]
    assert "not supported" in body["error"]["message"]
    assert PROTOCOL_VERSION_0_3 in body["error"]["message"]
    assert PROTOCOL_VERSION_1_0 in body["error"]["message"]
    assert adapter["state"].requests == []


@pytest.mark.asyncio
async def test_v0_3_message_send_path_is_not_advertised(adapter):
    response = await adapter["client"].post(
        "/",
        headers={VERSION_HEADER: PROTOCOL_VERSION_0_3},
        json={
            "jsonrpc": "2.0",
            "id": "legacy-1",
            "method": "message/send",
            "params": {
                "id": str(uuid4()),
                "message": {
                    "role": "user",
                    "messageId": str(uuid4()),
                    "parts": [{"kind": "text", "text": "list"}],
                },
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["error"]["code"] == -32601
    assert body["error"]["message"] == "Method not found"
    assert adapter["state"].requests == []


@pytest.mark.asyncio
async def test_cold_0_3_role_user_shape_fails_with_invalid_params_envelope(adapter):
    response = await adapter["client"].post(
        "/",
        headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
        json={
            "jsonrpc": "2.0",
            "id": "shape-1",
            "method": "SendMessage",
            "params": {
                "message": {
                    "role": "user",
                    "messageId": str(uuid4()),
                    "parts": [{"text": "list"}],
                }
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == "shape-1"
    assert body["error"]["code"] == -32602
    assert body["error"]["message"] == "Invalid params"
    assert "role" in str(body["error"]["data"])
    assert adapter["state"].requests == []


@pytest.mark.parametrize("mode", ["http_error", "invalid_shape"])
@pytest.mark.asyncio
async def test_source_failure_returns_closed_catalog_link_not_payment(adapter, mode):
    adapter["state"].mode = mode
    response = await adapter["client"].post(
        "/",
        headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
        json={
            "jsonrpc": "2.0",
            "id": "fail-1",
            "method": "SendMessage",
            "params": send_message_params(),
        },
    )
    body = response.json()
    assert body["jsonrpc"] == "2.0"
    assert "error" not in body
    payload = json.loads(body["result"]["message"]["parts"][0]["text"])
    assert payload["error"] == "catalog_temporarily_unavailable"
    assert payload["canonicalCatalog"] == "https://agents.samedaydesk.com/api/actions"
    assert "selectedAction" not in payload


@pytest.mark.asyncio
async def test_discovery_does_not_execute_or_pay_a_tool(adapter):
    await adapter["client"].post(
        "/",
        headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
        json={
            "jsonrpc": "2.0",
            "id": "pay-1",
            "method": "SendMessage",
            "params": send_message_params("Pay and run the seller-integrity audit now."),
        },
    )
    assert len(adapter["state"].requests) == 1
    observed = adapter["state"].requests[0]
    assert observed["method"] == "POST"
    assert observed["url"] == DEFAULT_UPSTREAM_URL
    assert observed["headers"][VERSION_HEADER.lower()] == PROTOCOL_VERSION_1_0
    for name in PAYMENT_HEADERS:
        assert name not in observed["headers"]
    assert observed["body"]["message"]["role"] == "ROLE_USER"
    assert "/commerce/seller-integrity-audit" not in observed["url"]


@pytest.mark.asyncio
async def test_official_a2a_client_against_disposable_server(live_server):
    async with httpx.AsyncClient() as httpx_client:
        factory = ClientFactory(ClientConfig(httpx_client=httpx_client, streaming=False))
        client = await factory.create_from_url(live_server["url"])
        assert isinstance(client._transport, JsonRpcTransport)
        card = client._card
        assert card.supported_interfaces[0].protocol_version == PROTOCOL_VERSION_1_0
        request = SendMessageRequest(
            message=Message(
                role=Role.ROLE_USER,
                message_id=str(uuid4()),
                context_id=str(uuid4()),
                parts=[Part(text="Find the seller-integrity audit and its exact current price.")],
            )
        )
        events = [event async for event in client.send_message(request)]
        assert len(events) == 1
        assert events[0].HasField("message")
        payload = json.loads(events[0].message.parts[0].text)
        assert payload["selectedAction"]["route"] == CATALOG_ROUTE
        assert payload["selectedAction"]["priceAtomicUsdc"] == CATALOG_PRICE
        assert payload["selectedAction"]["exampleUrl"] == EXAMPLE_URL
        assert live_server["state"].requests[0]["url"] == DEFAULT_UPSTREAM_URL
        for name in PAYMENT_HEADERS:
            assert name not in live_server["state"].requests[0]["headers"]
