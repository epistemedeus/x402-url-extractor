"""Synchronous AgentChat return for the Agentverse proxy.

The proxy forwards an envelope to /av/chat and returns that HTTP body.
agentverse-sdk 0.2.1 answers {} and sends the ChatMessage later, to the
sender's own endpoint. A caller with no listing then sees an empty body.
When the caller sets x-uagents-connection: sync, this route runs the existing
A2A handler and returns the reply envelope in the HTTP body. It does not
register an agent, send a payment, or write a journal.
"""

import json
from uuid import uuid4

from a2a.auth.user import UnauthenticatedUser
from a2a.server.context import ServerCallContext
from a2a.types import Message as A2AMessage
from a2a.types import Part, Role, SendMessageRequest
from agentverse_sdk._common.starlette import parse_chat_message_from_request
from agentverse_sdk.a2a.content import extract_content
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.identity import Identity
from uagents_core.models import Model
from uagents_core.protocol import ProtocolSpecification
from uagents_core.utils.messages import generate_message_envelope

SYNC_HEADER = "x-uagents-connection"
CHAT_PROTOCOL = ProtocolSpecification.compute_digest(chat_protocol_spec.manifest())


def _sdk_agent():
    try:
        from agentverse_sdk.a2a._app import _ctx
    except Exception:
        return None
    return getattr(_ctx, "agent", None)


def _sdk_chat():
    try:
        from agentverse_sdk.a2a._app import _ctx
    except Exception:
        return None
    integration = getattr(_ctx, "integration", None)
    if integration is None:
        return None
    return integration.chat


def reply_signer(app) -> Identity:
    agent = _sdk_agent()
    if agent is not None:
        return agent.uri.identity
    return app.state.chat_signer


def _reply_envelope(signer: Identity, destination: str, session, text: str):
    reply = ChatMessage(content=[TextContent(text=text)])
    return generate_message_envelope(
        destination=destination,
        message_schema_digest=Model.build_schema_digest(reply),
        message_body=json.loads(reply.model_dump_json()),
        sender=signer,
        session_id=session,
        protocol_digest=CHAT_PROTOCOL,
    )


def _envelope_response(envelope) -> Response:
    return Response(content=envelope.model_dump_json(), media_type="application/json")


async def chat_endpoint(request: Request) -> Response:
    if request.headers.get(SYNC_HEADER, "").lower() != "sync":
        delegate = _sdk_chat()
        if delegate is not None:
            return await delegate(request)
        return JSONResponse(
            {
                "kind": "refusal",
                "reason": "sync_required",
                "useful": False,
                "cash": 0,
                "paymentInferred": False,
            },
            status_code=400,
        )

    signer = reply_signer(request.app)
    env, msg = await parse_chat_message_from_request(
        request, True, signer.address
    )
    if isinstance(msg, ChatAcknowledgement) or not msg.text().strip():
        return JSONResponse({})

    message = A2AMessage(
        role=Role.ROLE_USER,
        message_id=str(uuid4()),
        parts=[Part(text=msg.text())],
    )
    try:
        result = await request.app.state.request_handler.on_message_send(
            SendMessageRequest(message=message),
            ServerCallContext(state={}, user=UnauthenticatedUser()),
        )
        content = await extract_content(result)
        text = ""
        for item in content:
            if isinstance(item, TextContent):
                text += item.text
        if not text:
            text = json.dumps(
                {
                    "kind": "refusal",
                    "reason": "empty_reply",
                    "useful": False,
                    "cash": 0,
                    "paymentInferred": False,
                }
            )
    except Exception:
        text = json.dumps(
            {
                "kind": "refusal",
                "reason": "upstream_error",
                "useful": False,
                "cash": 0,
                "paymentInferred": False,
            }
        )
    return _envelope_response(
        _reply_envelope(signer, env.sender, env.session, text)
    )
