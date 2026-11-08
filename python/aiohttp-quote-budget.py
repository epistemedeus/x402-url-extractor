"""Receive unsigned mounted quotes using aiohttp's default header limits."""

import asyncio
import json
import os
import sys
from urllib.parse import urlsplit

import aiohttp
from yarl import URL


async def main(base, routes):
    parsed = urlsplit(base)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username:
        raise ValueError("expected a loopback merchant")
    if aiohttp.__version__ != "3.14.5":
        raise RuntimeError(f"expected aiohttp 3.14.5, got {aiohttp.__version__}")

    responses = []
    host = os.environ.get("AIOHTTP_QUOTE_HOST")
    headers = {"host": host, "x-forwarded-proto": "https"} if host else None
    async with aiohttp.ClientSession() as client:
        for route in routes:
            if not route.startswith("/"):
                raise ValueError("expected an absolute request path")
            url = URL(base + route, encoded=True)
            try:
                async with client.get(url, headers=headers, allow_redirects=False) as response:
                    [(name, value)] = [(name, value) for name, value in response.raw_headers
                                       if name.lower() == b"payment-required"]
                    responses.append({"status": response.status, "lineBytes": len(name) + len(value) + 4})
                    await response.read()
            except aiohttp.ClientResponseError as error:
                if error.status != 400 or "more than 8190 bytes" not in error.message:
                    raise
                responses.append({"status": None, "limit": 8190})
    print(json.dumps({"python": sys.version.split()[0], "aiohttp": aiohttp.__version__, "responses": responses}))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2:]))
