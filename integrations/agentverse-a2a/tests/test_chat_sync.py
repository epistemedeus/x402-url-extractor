import json
from uuid import uuid4

import httpx
import pytest
from uagents_core.contrib.protocols.chat import (
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.protocol import ProtocolSpecification
from uagents_core.utils.messages import generate_message_envelope, parse_envelope_raw

from catalog_proxy import DEFAULT_READINESS_URL, DEFAULT_UPSTREAM_URL, CatalogProxyExecutor
from main import create_app
from tests.test_readiness_handoff import EXAMPLE_URL, catalog_body, readiness_body, route_transport

CHAT_PROTOCOL = ProtocolSpecification.compute_digest(chat_protocol_spec.manifest())


def signed_chat(sender: Identity, target: str, text: str) -> dict:
    msg = ChatMessage(content=[TextContent(text=text)])
    env = generate_message_envelope(
        destination=target,
        message_schema_digest=Model.build_schema_digest(msg),
        message_body=json.loads(msg.model_dump_json()),
        sender=sender,
        session_id=uuid4(),
        protocol_digest=CHAT_PROTOCOL,
    )
    return json.loads(env.model_dump_json())


async def post_chat(app, body, *, sync=True):
    headers = {"content-type": "application/json"}
    if sync:
        headers["x-uagents-connection"] = "sync"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://adapter.test") as http:
        response = await http.post("/av/chat", headers=headers, json=body)
    return response


def reply_text(response: httpx.Response) -> str:
    message = parse_envelope_raw(response.text, ChatMessage)
    assert isinstance(message, ChatMessage)
    return message.text()


@pytest.mark.asyncio
async def test_sync_chat_returns_the_free_tool_and_refuses_a_changed_name():
    client, seen = route_transport({
        ("POST", DEFAULT_READINESS_URL): (200, readiness_body()),
    })
    app = create_app(
        public_url="http://adapter.test",
        executor=CatalogProxyExecutor(client=client),
    )
    sender = Identity.generate()
    target = app.state.chat_signer.address
    useful = await post_chat(app, signed_chat(sender, target, json.dumps({
        "kind": "free-tool",
        "tool": "check_ai_readiness",
        "arguments": {"url": "https://example.com"},
        "label": "owner_qa",
    })))
    changed = await post_chat(app, signed_chat(sender, target, json.dumps({
        "kind": "free-tool",
        "tool": "check_ai_readiness_changed",
        "arguments": {"url": "https://example.com"},
        "label": "owner_qa",
    })))
    invalid = await post_chat(app, signed_chat(sender, target, json.dumps({
        "kind": "free-tool",
        "tool": "check_ai_readiness",
        "arguments": {"url": "http://example.com"},
        "label": "owner_qa",
    })))
    await client.aclose()

    assert useful.status_code == 200
    useful_body = json.loads(reply_text(useful))
    assert useful_body["kind"] == "free-tool"
    assert useful_body["structuredContent"]["score"] == 45
    assert useful_body["structuredContent"]["grade"] == "D"
    assert useful_body["paymentInferred"] is False
    assert useful_body["cash"] == 0

    assert changed.status_code == 200
    changed_body = json.loads(reply_text(changed))
    assert changed_body["kind"] == "refusal"
    assert changed_body["reason"] == "unknown_tool"
    assert changed_body["paymentInferred"] is False

    invalid_body = json.loads(reply_text(invalid))
    assert invalid_body["reason"] == "invalid_request"
    assert invalid_body["paymentInferred"] is False
    assert [call["url"] for call in seen] == [DEFAULT_READINESS_URL]


@pytest.mark.asyncio
async def test_sync_chat_returns_the_unpaid_challenge_and_ignores_a_payment_field():
    client, seen = route_transport({
        ("POST", DEFAULT_UPSTREAM_URL): (200, catalog_body()),
        ("GET", EXAMPLE_URL): (402, {
            "accepts": [{
                "scheme": "exact",
                "network": "eip155:8453",
                "amount": "10000",
                "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "payTo": "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
                "maxTimeoutSeconds": 300,
            }]
        }),
    })
    app = create_app(
        public_url="http://adapter.test",
        executor=CatalogProxyExecutor(client=client),
    )
    sender = Identity.generate()
    response = await post_chat(app, signed_chat(sender, app.state.chat_signer.address, json.dumps({
        "kind": "paid-challenge",
        "label": "owner_qa",
        "PAYMENT-SIGNATURE": "owner-qa-seeded-not-a-signature",
    })))
    await client.aclose()
    body = json.loads(reply_text(response))
    assert body["kind"] == "paid-challenge"
    assert body["paid"] is False
    assert body["paymentInferred"] is False
    assert body["paymentForwarded"] is False
    assert body["paymentIgnored"] == ["PAYMENT-SIGNATURE"]
    assert body["challenge"]["httpStatus"] == 402
    assert body["challenge"]["body"]["accepts"][0]["amount"] == "10000"
    get = [call for call in seen if call["method"] == "GET"][0]
    assert "payment-signature" not in get["headers"]


@pytest.mark.asyncio
async def test_missing_sync_header_and_bad_signature_are_refused():
    client, seen = route_transport({
        ("POST", DEFAULT_READINESS_URL): (200, readiness_body()),
    })
    app = create_app(
        public_url="http://adapter.test",
        executor=CatalogProxyExecutor(client=client),
    )
    sender = Identity.generate()
    body = signed_chat(sender, app.state.chat_signer.address, json.dumps({
        "kind": "free-tool",
        "tool": "check_ai_readiness",
        "arguments": {"url": "https://example.com"},
    }))
    missing = await post_chat(app, body, sync=False)
    body["signature"] = "not-a-signature"
    forged = await post_chat(app, body, sync=True)
    await client.aclose()
    assert missing.status_code == 400
    assert missing.json()["reason"] == "sync_required"
    assert forged.status_code == 400
    assert seen == []
