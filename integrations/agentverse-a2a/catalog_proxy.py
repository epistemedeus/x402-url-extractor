import json
from uuid import uuid4

import httpx
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue_v2 import EventQueue
from a2a.types import Message, Part, Role


MAX_UPSTREAM_BYTES = 128 * 1024
MAX_AGENT_TEXT_BYTES = 32 * 1024
MAX_ACTIONS = 64
DEFAULT_UPSTREAM_URL = "https://agents.samedaydesk.com/a2a/message:send"
PAYMENT_INTEGRITY_ROUTE = "/commerce/seller-integrity-audit"


class CatalogProxyError(RuntimeError):
    pass


def build_upstream_request(user_input: str, context_id: str | None) -> dict:
    return {
        "message": {
            "role": "ROLE_USER",
            "messageId": str(uuid4()),
            "contextId": context_id or str(uuid4()),
            "parts": [{"text": user_input or "List the current paid actions."}],
        }
    }


def extract_catalog_response(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise CatalogProxyError("upstream response is not an object")
    message = payload.get("message")
    if not isinstance(message, dict) or message.get("role") != "ROLE_AGENT":
        raise CatalogProxyError("upstream response has no agent message")
    parts = message.get("parts")
    if not isinstance(parts, list) or len(parts) != 1 or not isinstance(parts[0], dict):
        raise CatalogProxyError("upstream response has no single catalog part")
    catalog = parts[0].get("data")
    if not isinstance(catalog, dict):
        raise CatalogProxyError("upstream response has no catalog object")
    actions = catalog.get("actions")
    if not isinstance(actions, list) or len(actions) > MAX_ACTIONS:
        raise CatalogProxyError("upstream catalog actions are invalid or too wide")
    encoded = json.dumps(catalog, separators=(",", ":"), sort_keys=True)
    if len(encoded.encode("utf-8")) > MAX_UPSTREAM_BYTES:
        raise CatalogProxyError("upstream catalog exceeds the byte ceiling")
    return catalog


def select_payment_integrity_action(catalog: dict) -> dict:
    for action in catalog["actions"]:
        if isinstance(action, dict) and action.get("route") == PAYMENT_INTEGRITY_ROUTE:
            selected = {
                key: action[key]
                for key in (
                    "serviceName",
                    "name",
                    "route",
                    "url",
                    "method",
                    "description",
                    "priceAtomicUsdc",
                    "priceUsdc",
                    "paymentProtocols",
                )
                if key in action
            }
            request = action.get("request")
            example_url = request.get("exampleUrl") if isinstance(request, dict) else None
            if not isinstance(example_url, str) or not example_url.startswith("https://"):
                raise CatalogProxyError("seller-integrity audit has no exact example URL")
            selected["exampleUrl"] = example_url
            selected["declaredSource"] = {
                "header": "X-SameDayDesk-Agent-Source",
                "value": "agentverse-a2a-v1",
                "boundary": (
                    "Optional caller-declared attribution only. It is not "
                    "authenticated and cannot change price, payment, or access."
                ),
            }
            encoded = json.dumps(selected, separators=(",", ":"), sort_keys=True)
            if len(encoded.encode("utf-8")) > MAX_AGENT_TEXT_BYTES:
                raise CatalogProxyError("selected action exceeds the response ceiling")
            return selected
    raise CatalogProxyError("canonical catalog has no seller-integrity audit")


def agent_message(text: str, context_id: str | None = None) -> Message:
    return Message(
        role=Role.ROLE_AGENT,
        message_id=str(uuid4()),
        context_id=context_id or str(uuid4()),
        parts=[Part(text=text)],
    )


class CatalogProxyExecutor(AgentExecutor):
    def __init__(
        self,
        *,
        upstream_url: str = DEFAULT_UPSTREAM_URL,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._upstream_url = upstream_url
        self._client = client

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(12.0),
            follow_redirects=False,
        )
        try:
            response = await client.post(
                self._upstream_url,
                headers={"A2A-Version": "1.0"},
                json=build_upstream_request(context.get_user_input(), context.context_id),
            )
            response.raise_for_status()
            if len(response.content) > MAX_UPSTREAM_BYTES:
                raise CatalogProxyError("upstream response exceeds the byte ceiling")
            catalog = extract_catalog_response(response.json())
            selected_action = select_payment_integrity_action(catalog)
            text = json.dumps(
                {
                    "authority": "agents.samedaydesk.com",
                    "canonicalCatalog": "https://agents.samedaydesk.com/api/actions",
                    "openApi": "https://agents.samedaydesk.com/openapi.json",
                    "selectedAction": selected_action,
                    "instruction": (
                        "Use selectedAction.exampleUrl, inspect the live x402 or MPP "
                        "terms, then authorize payment only within your own policy. "
                        "Use openApi for the full request and response contract."
                    ),
                },
                separators=(",", ":"),
                sort_keys=True,
            )
            if len(text.encode("utf-8")) > MAX_AGENT_TEXT_BYTES:
                raise CatalogProxyError("agent response exceeds the byte ceiling")
        except (httpx.HTTPError, ValueError, CatalogProxyError) as exc:
            text = json.dumps(
                {
                    "error": "catalog_temporarily_unavailable",
                    "detail": str(exc)[:256],
                    "canonicalCatalog": "https://agents.samedaydesk.com/api/actions",
                },
                separators=(",", ":"),
                sort_keys=True,
            )
        finally:
            if owns_client:
                await client.aclose()

        await event_queue.enqueue_event(agent_message(text, context.context_id))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        await event_queue.enqueue_event(
            agent_message(
                "This discovery-only agent has no long-running task to cancel.",
                context.context_id,
            )
        )
