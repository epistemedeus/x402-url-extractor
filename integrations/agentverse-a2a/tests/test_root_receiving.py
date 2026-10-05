"""Root receiving regressions: no private credentials or network calls."""
import asyncio
import json

import httpx
import pytest

import catalog_proxy
from catalog_proxy import CatalogProxyExecutor, DEFAULT_READINESS_URL, DEFAULT_UPSTREAM_URL
from test_readiness_handoff import Context, Queue, EXAMPLE_URL, catalog_body, readiness_body, run_selection


@pytest.mark.asyncio
@pytest.mark.parametrize("url", [
    "https://example.com:bad", "https://[broken/", "https://example.com:99999",
    "https://192.168.1.1/", "https://169.254.169.254/", "https://[::1]/",
])
async def test_malformed_and_nonpublic_urls_refuse_without_upstream(url):
    result, seen = await run_selection(json.dumps({
        "kind": "free-tool", "tool": "check_ai_readiness", "arguments": {"url": url},
    }), {})
    assert result["kind"] == "refusal"
    assert result["reason"] == "invalid_request"
    assert seen == []


@pytest.mark.asyncio
async def test_overlapping_owned_clients_do_not_close_or_clear_each_other(monkeypatch):
    real_client = httpx.AsyncClient
    clients = []
    free_entered, catalog_entered = asyncio.Event(), asyncio.Event()
    release_free, release_catalog = asyncio.Event(), asyncio.Event()

    async def handler(request):
        if str(request.url) == DEFAULT_READINESS_URL:
            free_entered.set()
            await release_free.wait()
            return httpx.Response(200, json=readiness_body())
        if str(request.url) == DEFAULT_UPSTREAM_URL:
            catalog_entered.set()
            await release_catalog.wait()
            return httpx.Response(200, json=catalog_body())
        assert str(request.url) == EXAMPLE_URL
        return httpx.Response(402, json={"x402Version": 2, "accepts": []})

    def factory(*args, **kwargs):
        instance = real_client(transport=httpx.MockTransport(handler), **kwargs)
        clients.append(instance)
        return instance

    monkeypatch.setattr(catalog_proxy.httpx, "AsyncClient", factory)
    executor = CatalogProxyExecutor()
    free_queue, paid_queue = Queue(), Queue()
    free_task = asyncio.create_task(executor.execute(Context(json.dumps({
        "kind": "free-tool", "tool": "check_ai_readiness",
        "arguments": {"url": "https://example.com"},
    })), free_queue))
    paid_task = None
    try:
        await asyncio.wait_for(free_entered.wait(), 2)
        paid_task = asyncio.create_task(executor.execute(Context('{"kind":"paid-challenge"}'), paid_queue))
        await asyncio.wait_for(catalog_entered.wait(), 2)
        release_free.set()
        await asyncio.wait_for(free_task, 2)
        release_catalog.set()
        await asyncio.wait_for(paid_task, 2)
    finally:
        release_free.set()
        release_catalog.set()
        await asyncio.gather(*([free_task] + ([paid_task] if paid_task else [])), return_exceptions=True)
        for client in clients:
            await client.aclose()
    assert len(clients) == 2
    assert clients[0] is not clients[1]
    assert all(client.is_closed for client in clients)
    assert executor._client is None
    assert json.loads(free_queue.events[0].parts[0].text)["kind"] == "free-tool"
    assert json.loads(paid_queue.events[0].parts[0].text)["kind"] == "paid-challenge"


class OversizedStream(httpx.AsyncByteStream):
    def __init__(self):
        self.chunks = 0
        self.closed = False

    async def __aiter__(self):
        for _ in range(100):
            self.chunks += 1
            yield b"x" * 16384

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_plain_discovery_is_stream_bounded_before_full_buffering():
    stream = OversizedStream()

    async def handler(request):
        return httpx.Response(200, stream=stream)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        queue = Queue()
        await CatalogProxyExecutor(client=client).execute(Context("list audits"), queue)
    result = json.loads(queue.events[0].parts[0].text)
    assert result["kind"] == "refusal"
    assert result["reason"] == "body_budget"
    assert stream.closed
    assert stream.chunks <= 9
