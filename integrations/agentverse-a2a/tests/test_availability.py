import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from availability_fixture import STATUS_URL, availability_body
import catalog_proxy
from catalog_proxy import CatalogProxyExecutor, DEFAULT_READINESS_URL, DEFAULT_UPSTREAM_URL
from main import create_app
from test_readiness_handoff import Context, Queue, EXAMPLE_URL, catalog_body, readiness_body


@pytest.mark.asyncio
async def test_emitted_card_offers_current_status_and_apex_documentation():
    app = create_app(public_url="https://adapter.test")
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://adapter.test") as client:
            response = await client.get("/.well-known/agent-card.json")
        assert response.status_code == 200
        card = response.json()
        assert card["documentationUrl"] == "https://samedaydesk.com/skill.md"
        description = card["skills"][0]["description"]
        assert "availability" in description
        assert "free" in description
        assert "returns the live unpaid challenge" not in description
    finally:
        await app.state.request_handler.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("selection", ["List paid actions", '{"kind":"paid-challenge"}'])
async def test_paused_status_keeps_a_useful_next_action_without_merchant(selection):
    seen = []

    async def handler(request):
        seen.append(str(request.url))
        if str(request.url) == STATUS_URL:
            return httpx.Response(200, json=availability_body("paused"))
        if request.method == "POST":
            return httpx.Response(200, json=catalog_body())
        return httpx.Response(402, json={"accepts": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        queue = Queue()
        await CatalogProxyExecutor(client=client).execute(Context(selection), queue)
    payload = json.loads(queue.events[0].parts[0].text)
    assert payload["availability"]["state"] == "paused"
    assert payload["availability"]["callable"] is False
    assert payload["nextAction"] == "https://samedaydesk.com/discovery/useful-jobs.json"
    assert payload["freeTools"][0]["kind"] == "free-tool"
    assert "selectedAction" not in payload
    assert seen == [STATUS_URL]


async def execute(client, text="List paid actions", executor=None):
    queue = Queue()
    await (executor or CatalogProxyExecutor(client=client)).execute(Context(text), queue)
    return json.loads(queue.events[0].parts[0].text)


@pytest.mark.asyncio
@pytest.mark.parametrize("patch", [
    {"state": "unknown", "callable": False, "observedAt": None},
    {"state": "unknown", "callable": True},
    {"state": "launch", "callable": True},
    {"callable": "true"},
    {"callable": 1},
    {"origin": "https://other.example"},
    {"origin": "https://agents.samedaydesk.com.evil.example"},
    {"origin": "http://agents.samedaydesk.com"},
    {"origin": "https://user@agents.samedaydesk.com"},
    {"observedAt": None},
    {"observedAt": "not-a-date"},
    {"observedAt": "2026-02-30T01:50:00.000Z"},
])
@pytest.mark.parametrize("selection", ["List paid actions", '{"kind":"paid-challenge"}'])
async def test_unconfirmed_or_changed_schema_never_contacts_merchant(patch, selection):
    seen = []

    async def handler(request):
        seen.append(str(request.url))
        assert str(request.url) == STATUS_URL
        return httpx.Response(200, json={**availability_body(), **patch})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await execute(client, selection)
    assert payload["availability"]["state"] == "unknown"
    assert payload["availability"]["callable"] is False
    assert payload["nextAction"].startswith("https://samedaydesk.com/")
    assert payload["paymentForwarded"] is False
    assert "selectedAction" not in payload
    assert seen == [STATUS_URL]


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [None, [], {}, {"origin": "https://agents.samedaydesk.com"}])
async def test_missing_projection_is_unknown(body):
    async def handler(request):
        assert str(request.url) == STATUS_URL
        return httpx.Response(200, content=json.dumps(body), headers={"Content-Type": "application/json"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await execute(client)
    assert payload["availability"]["state"] == "unknown"


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [
    '{"origin":"https://agents.samedaydesk.com","state":"paused","state":"available","callable":true,"observedAt":"2026-10-22T21:10:00.000Z"}',
    json.dumps(availability_body())[:-1] + ',"extra":NaN}',
    json.dumps(availability_body())[:-1] + ',"extra":Infinity}',
    '[' * 1200 + ']' * 1200,
])
async def test_ambiguous_or_non_json_status_fails_unknown(body):
    async def handler(request):
        assert str(request.url) == STATUS_URL
        return httpx.Response(200, content=body, headers={"Content-Type": "application/json"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await execute(client, '{"kind":"paid-challenge"}')
    assert payload["availability"]["state"] == "unknown"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["http", "malformed", "html", "event-stream", "timeout", "connect", "oversize", "encoding"])
async def test_status_read_failure_is_unknown(failure):
    seen = []

    async def handler(request):
        seen.append(request)
        assert str(request.url) == STATUS_URL
        if failure == "timeout":
            raise httpx.ReadTimeout("synthetic", request=request)
        if failure == "connect":
            raise httpx.ConnectError("synthetic", request=request)
        if failure == "http":
            return httpx.Response(503, json=availability_body())
        if failure == "malformed":
            return httpx.Response(200, content=b"{", headers={"Content-Type": "application/json"})
        if failure == "html":
            return httpx.Response(200, text="<html>available</html>")
        if failure == "event-stream":
            return httpx.Response(200, content=b"data: available", headers={"Content-Type": "text/event-stream"})
        if failure == "encoding":
            return httpx.Response(200, content=b"not a supported encoding", headers={"Content-Type": "application/json", "Content-Encoding": "custom"})
        return httpx.Response(200, content=b"x" * (catalog_proxy.MAX_STATUS_BYTES + 1), headers={"Content-Type": "application/json"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await execute(client, '{"kind":"paid-challenge"}')
    assert payload["reason"] == "paid_gateway_unconfirmed"
    assert payload["availability"]["state"] == "unknown"
    assert len(seen) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("destination", [
    "https://other.example/discovery/paid-gateway.json",
    "https://samedaydesk.com.evil.example/discovery/paid-gateway.json",
    "https://user@samedaydesk.com/discovery/paid-gateway.json",
    "http://www.samedaydesk.com/discovery/paid-gateway.json",
    "https://www.samedaydesk.com:444/discovery/paid-gateway.json",
    "https://www.samedaydesk.com/discovery/other.json",
    "https://www.samedaydesk.com/discovery/paid-gateway.json?next=1",
    "/discovery/paid-gateway.json",  # actual VM observation: self redirect
    "",
])
async def test_status_redirects_are_exactly_bound(destination):
    seen = []

    async def handler(request):
        seen.append(str(request.url))
        return httpx.Response(307, headers={"location": destination})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await execute(client)
    assert payload["availability"]["state"] == "unknown"
    assert seen == [STATUS_URL]


@pytest.mark.asyncio
async def test_one_owned_www_redirect_is_received_but_loops_are_refused():
    www = "https://www.samedaydesk.com/discovery/paid-gateway.json"
    seen = []
    loop = False

    async def handler(request):
        seen.append(str(request.url))
        if str(request.url) == STATUS_URL:
            return httpx.Response(308, headers={"location": www})
        assert str(request.url) == www
        if loop:
            return httpx.Response(307, headers={"location": STATUS_URL})
        return httpx.Response(200, json=availability_body("paused"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await execute(client)
        assert payload["availability"]["state"] == "paused"
        assert payload["availability"]["source"] == STATUS_URL
        loop = True
        payload = await execute(client)
    assert payload["availability"]["state"] == "unknown"
    assert seen == [STATUS_URL, www, STATUS_URL, www]


class StatusStream(httpx.AsyncByteStream):
    def __init__(self, *, slow=False):
        self.slow = slow
        self.closed = False
        self.chunks = 0

    async def __aiter__(self):
        for _ in range(100):
            self.chunks += 1
            if self.slow:
                await asyncio.Event().wait()
            yield b"x" * 8192

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["stream-budget", "declared-budget", "slow-body", "slow-headers"])
async def test_status_bounds_close_streams_and_cancel_reads(monkeypatch, mode):
    monkeypatch.setattr(catalog_proxy, "STATUS_TIMEOUT_SECONDS", 0.03)
    stream = StatusStream(slow=mode == "slow-body")
    cancelled = asyncio.Event()

    async def handler(request):
        assert str(request.url) == STATUS_URL
        if mode == "slow-headers":
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        headers = {"content-type": "application/json"}
        if mode == "declared-budget":
            headers["content-length"] = str(catalog_proxy.MAX_STATUS_BYTES + 1)
        return httpx.Response(200, stream=stream, headers=headers)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await asyncio.wait_for(execute(client), 1)
    assert payload["availability"]["state"] == "unknown"
    if mode == "slow-headers":
        assert cancelled.is_set()
    else:
        assert stream.closed
        assert stream.chunks <= 3


@pytest.mark.asyncio
async def test_status_is_uncredentialed_and_json_urls_are_not_routing_authority():
    seen = []

    async def handler(request):
        seen.append(request)
        if str(request.url) == STATUS_URL:
            assert request.method == "GET"
            assert request.content == b""
            assert not any(name in request.headers for name in (
                "authorization", "cookie", "payment-signature", "x-payment", "x402-payment",
                "x-payment-signature", "x-uagents-connection", "x-samedaydesk-agent-source",
            ))
            assert request.extensions["timeout"]["read"] == 3.0
            return httpx.Response(200, json={
                **availability_body("paused"),
                "nextAction": "https://evil.example/pay",
                "alternatives": {"freeApexMcp": "https://evil.example/read"},
            })
        pytest.fail("status-supplied URL was followed")

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        auth=("synthetic", "not-a-credential"),
        headers={"Payment-Signature": "synthetic", "Cookie": "synthetic=1"},
        params={"caller": "synthetic"},
    ) as client:
        payload = await execute(client, '{"kind":"paid-challenge","authorization":"synthetic"}')
    assert "evil.example" not in json.dumps(payload)
    assert payload["freeApexMcp"] == DEFAULT_READINESS_URL
    assert payload["paymentIgnored"] == ["authorization"]
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_received_restoration_preserves_exact_catalog_and_unpaid_challenge_without_cache():
    state = "paused"
    seen = []

    async def handler(request):
        seen.append(request)
        if str(request.url) == STATUS_URL:
            return httpx.Response(200, json=availability_body(state))
        if str(request.url) == DEFAULT_UPSTREAM_URL:
            return httpx.Response(200, json=catalog_body())
        assert str(request.url) == EXAMPLE_URL
        return httpx.Response(402, json={"x402Version": 2, "accepts": [{"amount": "10000"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        executor = CatalogProxyExecutor(client=client)
        assert (await execute(client, executor=executor))["availability"]["state"] == "paused"
        state = "available"
        discovery = await execute(client, '{"kind":"discovery","PAYMENT-SIGNATURE":"synthetic"}', executor)
        assert discovery["selectedAction"]["priceAtomicUsdc"] == "10000"
        assert discovery["availability"]["observedAt"] == availability_body()["observedAt"]
        challenge = await execute(client, '{"kind":"paid-challenge","PAYMENT-SIGNATURE":"synthetic"}', executor)
        assert challenge["challenge"]["httpStatus"] == 402
        assert challenge["paid"] is False
        assert challenge["paymentForwarded"] is False
        state = "unknown"
        assert (await execute(client, '{"kind":"paid-challenge"}', executor))["reason"] == "paid_gateway_unconfirmed"
    assert [str(request.url) for request in seen] == [
        STATUS_URL, STATUS_URL, DEFAULT_UPSTREAM_URL, STATUS_URL, DEFAULT_UPSTREAM_URL, EXAMPLE_URL, STATUS_URL,
    ]
    assert all("payment-signature" not in request.headers for request in seen)
    assert "synthetic" not in "".join(request.content.decode() for request in seen)


@pytest.mark.asyncio
async def test_concurrent_status_calls_and_free_tool_are_isolated():
    paused_entered, release_paused = asyncio.Event(), asyncio.Event()
    status_count = 0
    seen = []

    async def handler(request):
        nonlocal status_count
        seen.append(str(request.url))
        if str(request.url) == STATUS_URL:
            status_count += 1
            if status_count == 1:
                paused_entered.set()
                await release_paused.wait()
                return httpx.Response(200, json=availability_body("paused"))
            return httpx.Response(200, json=availability_body())
        if str(request.url) == DEFAULT_READINESS_URL:
            return httpx.Response(200, json=readiness_body())
        if str(request.url) == DEFAULT_UPSTREAM_URL:
            return httpx.Response(200, json=catalog_body())
        assert str(request.url) == EXAMPLE_URL
        return httpx.Response(402, json={"accepts": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        executor = CatalogProxyExecutor(client=client)
        paused = asyncio.create_task(execute(client, '{"kind":"paid-challenge"}', executor))
        try:
            await asyncio.wait_for(paused_entered.wait(), 1)
            free = await asyncio.wait_for(execute(client, json.dumps({
                "kind": "free-tool", "tool": "check_agent_readiness", "arguments": {"host": "example.com"},
            }), executor), 1)
            restored = await asyncio.wait_for(execute(client, '{"kind":"paid-challenge"}', executor), 1)
            assert free["kind"] == "free-tool"
            assert restored["kind"] == "paid-challenge"
            assert not client.is_closed
        finally:
            release_paused.set()
            paused_payload = await asyncio.wait_for(paused, 1)
    assert paused_payload["reason"] == "paid_gateway_paused"
    assert status_count == 2
    assert seen.count(DEFAULT_UPSTREAM_URL) == 1
    assert seen.count(EXAMPLE_URL) == 1


@pytest.mark.asyncio
async def test_native_and_signed_sync_chat_receive_paused_status():
    from test_chat_sync import post_chat, reply_text, signed_chat
    from uagents_core.identity import Identity

    seen = []

    async def handler(request):
        seen.append(str(request.url))
        assert str(request.url) == STATUS_URL
        return httpx.Response(200, json=availability_body("paused"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
        app = create_app(public_url="https://adapter.test", executor=CatalogProxyExecutor(client=upstream))
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://adapter.test") as client:
                response = await client.post("/", headers={"A2A-Version": "1.0"}, json={
                    "jsonrpc": "2.0", "id": "paused-native", "method": "SendMessage",
                    "params": {"message": {"role": "ROLE_USER", "messageId": str(uuid4()), "parts": [{"text": '{"kind":"paid-challenge"}'}]}},
                })
            native = json.loads(response.json()["result"]["message"]["parts"][0]["text"])
            caller = Identity.generate()
            sync = await post_chat(app, signed_chat(caller, app.state.chat_signer.address, '{"kind":"paid-challenge"}'))
            assert native == json.loads(reply_text(sync))
            assert native["reason"] == "paid_gateway_paused"
        finally:
            await app.state.request_handler.aclose()
    assert seen == [STATUS_URL, STATUS_URL]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["paused", "unknown"])
async def test_free_readiness_survives_unavailable_paid_status(state):
    seen = []

    async def handler(request):
        seen.append(str(request.url))
        if str(request.url) == STATUS_URL:
            return httpx.Response(200, json=availability_body(state))
        assert str(request.url) == DEFAULT_READINESS_URL
        return httpx.Response(200, json=readiness_body())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await execute(client)
        payload = await execute(client, json.dumps({
            "kind": "free-tool", "tool": "check_ai_readiness", "arguments": {"url": "https://example.com"},
        }))
    assert payload["useful"] is True
    assert payload["structuredContent"]["score"] == 45
    assert seen == [STATUS_URL, DEFAULT_READINESS_URL]


@pytest.mark.asyncio
async def test_available_status_with_failed_catalog_keeps_free_and_offline_next_action():
    async def handler(request):
        if str(request.url) == STATUS_URL:
            return httpx.Response(200, json=availability_body())
        assert str(request.url) == DEFAULT_UPSTREAM_URL
        return httpx.Response(503, text="synthetic unavailable")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        payload = await execute(client)
    assert payload["error"] == "catalog_temporarily_unavailable"
    assert payload["availability"]["state"] == "available"
    assert "selectedAction" not in payload
    assert payload["freeTools"][0]["kind"] == "free-tool"
    assert payload["nextAction"] == "https://samedaydesk.com/discovery/useful-jobs.json"


@pytest.mark.asyncio
async def test_async_chat_still_delegates_to_sdk(monkeypatch):
    import chat_sync
    from starlette.responses import JSONResponse
    from test_chat_sync import post_chat

    delegated = []

    async def sdk_chat(request):
        delegated.append(await request.json())
        return JSONResponse({})

    monkeypatch.setattr(chat_sync, "_sdk_chat", lambda: sdk_chat)
    app = create_app(public_url="https://adapter.test")
    try:
        response = await post_chat(app, {"sdk": "async-envelope"}, sync=False)
        assert response.status_code == 200
        assert response.json() == {}
        assert delegated == [{"sdk": "async-envelope"}]
    finally:
        await app.state.request_handler.aclose()
