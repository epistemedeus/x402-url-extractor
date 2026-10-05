"""Owner QA only. Calls the public free readiness tool and the unpaid merchant
challenge through this adapter. Sends no payment and no Agentverse credential.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

os.environ["AGENTVERSE_A2A_SKIP_PRODUCTION_APP"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from a2a.utils.constants import PROTOCOL_VERSION_1_0, VERSION_HEADER

from catalog_proxy import CatalogProxyExecutor
from main import create_app


async def send(http, text, message_id):
    response = await http.post(
        "/",
        headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
        json={
            "jsonrpc": "2.0",
            "id": message_id,
            "method": "SendMessage",
            "params": {
                "message": {
                    "role": "ROLE_USER",
                    "messageId": message_id,
                    "contextId": "owner-qa-1005",
                    "parts": [{"text": text}],
                }
            },
        },
    )
    body = response.json()
    text_out = body.get("result", {}).get("message", {}).get("parts", [{}])[0].get("text")
    payload = json.loads(text_out) if text_out else {"jsonrpcError": body.get("error")}
    return {"id": message_id, "http": response.status_code, "payload": payload}


async def main():
    client = httpx.AsyncClient(timeout=httpx.Timeout(45.0), follow_redirects=False)
    app = create_app(public_url="http://adapter.local", executor=CatalogProxyExecutor(client=client))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://adapter.local", timeout=50.0) as http:
        useful = await send(http, json.dumps({
            "kind": "free-tool",
            "tool": "check_ai_readiness",
            "arguments": {"url": "https://example.com"},
            "label": "owner_qa",
        }), "owner-qa-useful")
        changed = await send(http, json.dumps({
            "kind": "free-tool",
            "tool": "check_ai_readiness_changed",
            "arguments": {"url": "https://example.com"},
            "label": "owner_qa",
        }), "owner-qa-changed")
        refusal = await send(http, json.dumps({
            "kind": "paid-challenge",
            "label": "owner_qa",
            "PAYMENT-SIGNATURE": "owner-qa-seeded-not-a-signature",
        }), "owner-qa-refusal")
    await app.state.request_handler.aclose()
    await client.aclose()
    report = {
        "label": "owner_qa",
        "cash": 0,
        "deployed": False,
        "controls": {"useful": useful, "changed": changed, "refusal": refusal},
    }
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    useful_ok = useful["payload"].get("useful") is True and isinstance(
        (useful["payload"].get("structuredContent") or {}).get("score"), int
    )
    changed_ok = changed["payload"].get("reason") == "unknown_tool"
    challenge = (refusal["payload"].get("challenge") or {})
    refusal_ok = (
        refusal["payload"].get("paid") is False
        and refusal["payload"].get("paymentInferred") is False
        and challenge.get("httpStatus") == 402
    )
    if not (useful_ok and changed_ok and refusal_ok):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
