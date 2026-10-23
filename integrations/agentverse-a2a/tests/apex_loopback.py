"""Cross-repository receiving helper. Only a loopback apex is permitted.

Invoked by samedaydesk/server/scripts/test-mcp-source-outcomes.js with the
existing isolated adapter environment. No Agentverse account or live service.
"""
import asyncio
import json
import sys
from urllib.parse import urlparse

import httpx
from catalog_proxy import CatalogProxyExecutor


class Context:
    context_id = "loopback-owner-qa"

    def get_user_input(self):
        return sys.argv[2]


class Queue:
    async def enqueue_event(self, event):
        print(event.parts[0].text)


async def main():
    endpoint = urlparse(sys.argv[1])
    if endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1" or endpoint.path != "/mcp":
        raise RuntimeError("loopback apex required")
    async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
        executor = CatalogProxyExecutor(readiness_url=sys.argv[1], client=client)
        await executor.execute(Context(), Queue())


if __name__ == "__main__":
    asyncio.run(main())
