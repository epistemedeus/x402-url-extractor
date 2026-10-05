"""Owner QA for the sync AgentChat return. Calls the public apex and the
unpaid merchant challenge through this process. Sends no payment and does
not register an agent.
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
from uagents_core.contrib.protocols.chat import (
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.protocol import ProtocolSpecification
from uagents_core.utils.messages import generate_message_envelope, parse_envelope_raw

from catalog_proxy import CatalogProxyExecutor
from main import create_app

CHAT_PROTOCOL = ProtocolSpecification.compute_digest(chat_protocol_spec.manifest())


def envelope(sender, target, text):
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


async def call(http, sender, target, text):
    response = await http.post(
        "/av/chat",
        headers={"content-type": "application/json", "x-uagents-connection": "sync"},
        json=envelope(sender, target, text),
    )
    message = parse_envelope_raw(response.text, ChatMessage)
    payload = json.loads(message.text()) if isinstance(message, ChatMessage) else None
    return {"http": response.status_code, "payload": payload}


async def main():
    client = httpx.AsyncClient(timeout=httpx.Timeout(45.0), follow_redirects=False)
    app = create_app(public_url="http://adapter.local", executor=CatalogProxyExecutor(client=client))
    sender = Identity.generate()
    target = app.state.chat_signer.address
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://adapter.local", timeout=50.0) as http:
        useful = await call(http, sender, target, json.dumps({
            "kind": "free-tool",
            "tool": "check_ai_readiness",
            "arguments": {"url": "https://example.com"},
            "label": "owner_qa",
        }))
        changed = await call(http, sender, target, json.dumps({
            "kind": "free-tool",
            "tool": "check_ai_readiness_changed",
            "arguments": {"url": "https://example.com"},
            "label": "owner_qa",
        }))
        invalid = await call(http, sender, target, json.dumps({
            "kind": "free-tool",
            "tool": "check_ai_readiness",
            "arguments": {"url": "http://example.com"},
            "label": "owner_qa",
        }))
        refusal = await call(http, sender, target, json.dumps({
            "kind": "paid-challenge",
            "label": "owner_qa",
            "PAYMENT-SIGNATURE": "owner-qa-seeded-not-a-signature",
        }))
    await app.state.request_handler.aclose()
    await client.aclose()
    report = {
        "label": "owner_qa",
        "cash": 0,
        "credentialUsed": False,
        "newListing": False,
        "deployed": False,
        "controls": {
            "useful": useful,
            "changed": changed,
            "invalid": invalid,
            "refusal": refusal,
        },
    }
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    score = ((useful["payload"] or {}).get("structuredContent") or {}).get("score")
    challenge = ((refusal["payload"] or {}).get("challenge") or {})
    ok = (
        useful["payload"].get("kind") == "free-tool"
        and isinstance(score, int)
        and useful["payload"].get("paymentInferred") is False
        and changed["payload"].get("reason") == "unknown_tool"
        and invalid["payload"].get("reason") == "invalid_request"
        and refusal["payload"].get("paid") is False
        and refusal["payload"].get("paymentInferred") is False
        and challenge.get("httpStatus") == 402
    )
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
