import json
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue_v2 import EventQueue
from a2a.types import Message, Part, Role
from a2a.utils.constants import PROTOCOL_VERSION_1_0, VERSION_HEADER


MAX_UPSTREAM_BYTES = 128 * 1024
MAX_AGENT_TEXT_BYTES = 32 * 1024
MAX_ACTIONS = 64
DEFAULT_UPSTREAM_URL = "https://agents.samedaydesk.com/a2a/message:send"
DEFAULT_READINESS_URL = "https://samedaydesk.com/mcp"
READINESS_PROTOCOL = "2025-11-25"
PAYMENT_INTEGRITY_ROUTE = "/commerce/seller-integrity-audit"
DECLARED_SOURCE_HEADER = "X-SameDayDesk-Agent-Source"
DECLARED_SOURCE_VALUE = "agentverse-a2a-v1"
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
PAYMENT_FIELDS = {
    "authorization",
    "payment-signature",
    "www-authenticate",
    "x-payment",
    "x-payment-signature",
    "x402-payment",
}
# Apex tools accepted at SDS270/271. Paid tools stay on their own handlers.
FREE_READINESS_TOOLS = {
    "check_ai_readiness": ("url",),
    "check_agent_readiness": ("host",),
}


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
                    "Optional caller-declared metadata only. It is not "
                    "attribution, not authenticated, and cannot change price, "
                    "payment, or access."
                ),
            }
            encoded = json.dumps(selected, separators=(",", ":"), sort_keys=True)
            if len(encoded.encode("utf-8")) > MAX_AGENT_TEXT_BYTES:
                raise CatalogProxyError("selected action exceeds the response ceiling")
            return selected
    raise CatalogProxyError("canonical catalog has no seller-integrity audit")


def dumps(payload: dict) -> str:
    text = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    if len(text.encode("utf-8")) > MAX_AGENT_TEXT_BYTES:
        raise CatalogProxyError("body_budget")
    return text


def refusal(reason: str, detail: str | None = None, **extra) -> str:
    payload = {
        "cash": 0,
        "kind": "refusal",
        "paymentInferred": False,
        "reason": reason,
        "useful": False,
    }
    if detail:
        payload["detail"] = detail[:256]
    payload.update(extra)
    try:
        return dumps(payload)
    except CatalogProxyError:
        payload.pop("detail", None)
        for key in list(extra):
            payload.pop(key, None)
        return dumps(payload)


def payment_fields(payload: dict) -> list[str]:
    found = []
    for key in payload:
        if str(key).lower() in PAYMENT_FIELDS:
            found.append(str(key))
    arguments = payload.get("arguments")
    if isinstance(arguments, dict):
        for key in arguments:
            if str(key).lower() in PAYMENT_FIELDS:
                found.append(str(key))
    return found


def valid_readiness_url(value: str) -> bool:
    parsed = urlparse(value.strip())
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        return False
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} or host.endswith(".local") or "." not in host:
        return False
    return True


def valid_readiness_host(value: str) -> bool:
    host = value.strip().lower().rstrip(".")
    if "://" in host or "/" in host or "@" in host or " " in host:
        return False
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} or host.endswith(".local") or "." not in host:
        return False
    return host.replace(".", "").replace("-", "").isalnum()


def parse_caller_selection(user_input: str) -> dict:
    text = (user_input or "").strip()
    if not (text.startswith("{") and text.endswith("}")):
        return {"kind": "discovery"}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return {"kind": "invalid", "reason": "invalid_request", "detail": "selection JSON is not an object"}
    if not isinstance(payload, dict) or "kind" not in payload:
        return {"kind": "discovery"}
    ignored = payment_fields(payload)
    kind = payload.get("kind")
    if kind == "discovery":
        return {"kind": "discovery", "paymentIgnored": ignored}
    if kind == "paid-challenge":
        return {"kind": "paid-challenge", "paymentIgnored": ignored}
    if kind != "free-tool":
        return {
            "kind": "invalid",
            "reason": "invalid_request",
            "detail": "kind must be free-tool, paid-challenge, or discovery",
        }
    tool = payload.get("tool")
    if not isinstance(tool, str) or tool not in FREE_READINESS_TOOLS:
        return {
            "kind": "invalid",
            "reason": "unknown_tool",
            "detail": "free readiness tool is absent or changed",
            "tool": tool if isinstance(tool, str) else None,
        }
    arguments = payload.get("arguments")
    if not isinstance(arguments, dict):
        return {"kind": "invalid", "reason": "invalid_request", "detail": "arguments must be an object"}
    cleaned = {}
    for key in FREE_READINESS_TOOLS[tool]:
        value = arguments.get(key)
        if not isinstance(value, str) or not value.strip():
            return {"kind": "invalid", "reason": "invalid_request", "detail": f"{key} is required"}
        if key == "url" and not valid_readiness_url(value):
            return {"kind": "invalid", "reason": "invalid_request", "detail": "url must be a public https URL"}
        if key == "host" and not valid_readiness_host(value):
            return {"kind": "invalid", "reason": "invalid_request", "detail": "host must be a public hostname"}
        cleaned[key] = value.strip()
    return {"kind": "free-tool", "tool": tool, "arguments": cleaned, "paymentIgnored": ignored}


def project_challenge_body(body: bytes) -> dict:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return {"unparsed": body.decode("utf-8", "replace")[:1500]}
    if not isinstance(parsed, dict):
        return {"unparsed": body.decode("utf-8", "replace")[:1500]}
    accepts = []
    for item in parsed.get("accepts") if isinstance(parsed.get("accepts"), list) else []:
        if not isinstance(item, dict):
            continue
        accepts.append({
            key: item.get(key)
            for key in ("scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds")
            if key in item
        })
    resource = parsed.get("resource") if isinstance(parsed.get("resource"), dict) else {}
    projected = {
        "accepts": accepts,
        "error": parsed.get("error"),
        "resource": {
            "mimeType": resource.get("mimeType"),
            "url": resource.get("url"),
        },
        "x402Version": parsed.get("x402Version"),
    }
    full = json.dumps(parsed, separators=(",", ":"), sort_keys=True)
    if len(full.encode("utf-8")) <= 12_000:
        projected["body"] = parsed
        projected["truncated"] = False
    else:
        projected["truncated"] = True
    return projected


async def read_bounded(response: httpx.Response) -> bytes:
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type.lower():
        await response.aclose()
        raise CatalogProxyError("stream_refused")
    if response.status_code in REDIRECT_STATUSES:
        await response.aclose()
        raise CatalogProxyError("redirect_refused")
    declared = response.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_UPSTREAM_BYTES:
        await response.aclose()
        raise CatalogProxyError("body_budget")
    chunks = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > MAX_UPSTREAM_BYTES:
            await response.aclose()
            raise CatalogProxyError("body_budget")
        chunks.append(chunk)
    return b"".join(chunks)


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
        readiness_url: str = DEFAULT_READINESS_URL,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._upstream_url = upstream_url
        self._readiness_url = readiness_url
        self._client = client

    async def _discovery_text(self, user_input: str, context_id: str | None) -> str:
        response = await self._client.post(
            self._upstream_url,
            headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
            json=build_upstream_request(user_input, context_id),
            follow_redirects=False,
        )
        if response.status_code in REDIRECT_STATUSES:
            raise CatalogProxyError("redirect_refused")
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" in content_type.lower():
            raise CatalogProxyError("stream_refused")
        response.raise_for_status()
        if len(response.content) > MAX_UPSTREAM_BYTES:
            raise CatalogProxyError("upstream response exceeds the byte ceiling")
        catalog = extract_catalog_response(response.json())
        selected_action = select_payment_integrity_action(catalog)
        return dumps({
            "authority": "agents.samedaydesk.com",
            "canonicalCatalog": "https://agents.samedaydesk.com/api/actions",
            "instruction": (
                "Plain text discovers the current paid action only. "
                "Send kind free-tool to call the apex readiness tool, or "
                "kind paid-challenge to read the live unpaid challenge. "
                "Use selectedAction.exampleUrl and authorize payment only within your own policy."
            ),
            "openApi": "https://agents.samedaydesk.com/openapi.json",
            "selectedAction": selected_action,
        })

    async def _load_selected_action(self, user_input: str, context_id: str | None) -> dict:
        async with self._client.stream(
            "POST",
            self._upstream_url,
            headers={VERSION_HEADER: PROTOCOL_VERSION_1_0},
            json=build_upstream_request(user_input, context_id),
            follow_redirects=False,
        ) as response:
            body = await read_bounded(response)
            if response.status_code >= 400:
                raise CatalogProxyError("upstream_error")
        catalog = extract_catalog_response(json.loads(body))
        return select_payment_integrity_action(catalog)

    async def _free_tool_text(self, selection: dict) -> str:
        tool = selection["tool"]
        arguments = selection["arguments"]
        request = {
            "jsonrpc": "2.0",
            "id": "agentverse-a2a-free-tool",
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments},
        }
        async with self._client.stream(
            "POST",
            self._readiness_url,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "mcp-protocol-version": READINESS_PROTOCOL,
            },
            json=request,
            follow_redirects=False,
        ) as response:
            body = await read_bounded(response)
            status = response.status_code
        if status >= 400:
            return refusal("upstream_error", f"readiness HTTP {status}")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise CatalogProxyError("upstream_error") from exc
        if not isinstance(payload, dict):
            raise CatalogProxyError("upstream_error")
        if isinstance(payload.get("error"), dict):
            return refusal("upstream_error", str(payload["error"].get("message") or "upstream error"))
        result = payload.get("result")
        if not isinstance(result, dict) or result.get("isError") is True:
            return refusal("tool_refused", "readiness tool refused the request")
        structured = result.get("structuredContent") if isinstance(result.get("structuredContent"), dict) else None
        text = ""
        content = result.get("content")
        if isinstance(content, list) and content and isinstance(content[0], dict):
            text = str(content[0].get("text") or "")[:1500]
        if structured is None and not text:
            raise CatalogProxyError("upstream_error")
        payload = {
            "arguments": arguments,
            "cash": 0,
            "kind": "free-tool",
            "owner": self._readiness_url,
            "paymentForwarded": False,
            "paymentIgnored": selection.get("paymentIgnored") or [],
            "paymentInferred": False,
            "structuredContent": structured,
            "text": text,
            "tool": tool,
            "useful": True,
        }
        try:
            return dumps(payload)
        except CatalogProxyError:
            payload["text"] = ""
            payload["truncated"] = True
            return dumps(payload)

    async def _paid_challenge_text(self, selection: dict, context_id: str | None) -> str:
        selected = await self._load_selected_action("List the current paid actions.", context_id)
        example_url = selected.get("exampleUrl")
        action_url = selected.get("url")
        if not isinstance(example_url, str) or not isinstance(action_url, str):
            return refusal("invalid_request", "catalog action has no bound example URL")
        if urlparse(example_url).hostname != urlparse(action_url).hostname:
            return refusal("invalid_request", "example URL host does not match the catalog action")
        async with self._client.stream(
            "GET",
            example_url,
            headers={
                "Accept": "application/json",
                DECLARED_SOURCE_HEADER: DECLARED_SOURCE_VALUE,
            },
            follow_redirects=False,
        ) as response:
            body = await read_bounded(response)
            status = response.status_code
            content_type = response.headers.get("content-type", "")
        if status in REDIRECT_STATUSES:
            return refusal("redirect_refused")
        if status != 402:
            return refusal(
                "unchallenged" if status < 400 else "upstream_error",
                f"merchant HTTP {status} is not an unpaid challenge",
            )
        payload = {
            "cash": 0,
            "challenge": {
                "body": project_challenge_body(body),
                "contentType": content_type.split(";")[0],
                "httpStatus": 402,
            },
            "declaredSource": selected.get("declaredSource"),
            "kind": "paid-challenge",
            "paid": False,
            "paymentForwarded": False,
            "paymentIgnored": selection.get("paymentIgnored") or [],
            "paymentInferred": False,
            "selectedAction": selected,
        }
        try:
            return dumps(payload)
        except CatalogProxyError:
            payload["challenge"]["body"].pop("body", None)
            payload["challenge"]["body"]["truncated"] = True
            return dumps(payload)

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            follow_redirects=False,
        )
        self._client = client
        selection = parse_caller_selection(context.get_user_input())
        try:
            if selection["kind"] == "invalid":
                extra = {"tool": selection["tool"]} if selection.get("tool") else {}
                text = refusal(selection["reason"], selection.get("detail"), **extra)
            elif selection["kind"] == "free-tool":
                text = await self._free_tool_text(selection)
            elif selection["kind"] == "paid-challenge":
                text = await self._paid_challenge_text(selection, context.context_id)
            else:
                text = await self._discovery_text(context.get_user_input(), context.context_id)
        except (httpx.HTTPError, ValueError, CatalogProxyError) as exc:
            reason = str(exc)
            if selection["kind"] == "discovery" and reason not in {
                "stream_refused",
                "redirect_refused",
                "body_budget",
            }:
                text = dumps({
                    "canonicalCatalog": "https://agents.samedaydesk.com/api/actions",
                    "detail": reason[:256],
                    "error": "catalog_temporarily_unavailable",
                })
            else:
                code = reason if reason in {
                    "stream_refused",
                    "redirect_refused",
                    "body_budget",
                    "upstream_error",
                    "tool_refused",
                } else "upstream_error"
                text = refusal(code, None if code == reason else reason[:256])
        finally:
            if owns_client:
                await client.aclose()
                self._client = None

        await event_queue.enqueue_event(agent_message(text, context.context_id))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        await event_queue.enqueue_event(
            agent_message(
                "This discovery-only agent has no long-running task to cancel.",
                context.context_id,
            )
        )
