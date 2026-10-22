# Agentverse A2A adapter

This process exposes current paid-gateway availability and two bounded free SameDayDesk tools through JSON-RPC 1.0 and the registered AgentChat identity. When the canonical gateway state is available, it exposes the existing catalog and can retrieve an unpaid merchant challenge. It never forwards payment authority, pays, or performs a paid tool call. AgentChat replies are signed by the existing registered identity. The first-party catalog remains `a2a-storefront.mjs` (`A2A_VERSION = "1.0"`). Documentation is at `https://samedaydesk.com/skill.md`.

## Availability and useful next actions

Discovery and `paid-challenge` first GET `https://samedaydesk.com/discovery/paid-gateway.json`. This existing SameDayDesk projection owns the received dependency state. The consumer preserves its exact `origin`, `state`, `callable` and `observedAt` with the canonical `source` URL. It accepts only `origin: "https://agents.samedaydesk.com"` and consistent `available`/`paused`/`unknown` facts. Restoration evidence stays with the producer; the adapter adds no expiry, background probe or stored status.

A read has a five-second total deadline, three-second HTTP operation timeouts and a 16KiB decoded body ceiling. Only one redirect to the exact HTTPS apex/www status URL is accepted. Self redirects, other origins, paths or query strings are refused. Status requests inherit no client authentication, cookies, caller headers or payment fields. JSON-supplied URLs never select a network destination.

Paused status returns `availability.state: "paused"`; a missing, malformed or failed read returns `unknown`. Both prevent catalog and challenge requests to the merchant. Discovery returns the existing offline job catalog and copyable free-tool selections; `paid-challenge` returns a refusal with those next actions. Free-tool calls go directly to the apex MCP independently of paid status. Acquired packages remain usable offline.

## Why `protocol_version` must be set

`a2a-sdk[http-server]==1.1.2` JSON-RPC handlers are `@validate_version("1.0")`. Missing `A2A-Version` is treated as `0.3` and rejected. `create_jsonrpc_routes(..., enable_v0_3_compat=False)` is required: `message/send` and `role: "user"` are not this server.

If `AgentInterface.protocol_version` is left empty, `agent_card_to_dict` merges v0.3 compat fields and advertises top-level `protocolVersion: "0.3"`. Clients that follow the card then send 0.3 shapes and fail against `lf.a2a.v1` `SendMessage`. Set the interface to `"1.0"` so the card matches the handlers.

## Operator check after deploy

No new Agentverse account, key, or registration. Redeploy this adapter only.

```bash
curl -sS "$PUBLIC_URL/.well-known/agent-card.json"
```

Expect `supportedInterfaces[0].protocolBinding` = `JSONRPC`, `protocolVersion` = `1.0`, and no top-level `protocolVersion` of `0.3`. JSON-RPC is `POST $PUBLIC_URL/` with header `A2A-Version: 1.0`, method `SendMessage`, and `message.role` = `ROLE_USER`.

Plain text checks availability. With a valid available projection it returns the current seller-integrity audit `route` / `priceAtomicUsdc` / `exampleUrl`; otherwise it returns status and free/offline next actions. Callers authorize any later merchant request themselves. The bridge does not infer a payment header from the message and does not pay.

Two exact JSON selections use the same `SendMessage` envelope:

```json
{"kind":"free-tool","tool":"check_ai_readiness","arguments":{"url":"https://example.com"}}
{"kind":"paid-challenge"}
```

`check_ai_readiness` and `check_agent_readiness` are the apex free tools at `https://samedaydesk.com/mcp`. Any other tool name is a refusal. When available, `paid-challenge` reads the catalog example URL with `X-SameDayDesk-Agent-Source: agentverse-a2a-v1` and returns the merchant 402. That header is caller-declared metadata, not attribution. A 200, redirect, event stream, or oversized body is refused. The optional later paid call is the caller's own request to `selectedAction.exampleUrl`. The existing merchant outcome header `x-samedaydesk-outcome-task` is not written here.

Run the complete owning suite serially in an isolated Python environment from this directory with `python -m pytest -q`. It includes emitted-card, paused/unknown/failure, origin/redirect, streaming/deadline, valid-restoration and overlapping-call cases alongside native protocol and signed Chat regressions. Fixtures do not establish installed behavior. After Root releases the exact reviewed source, receive the public card, native SendMessage and signed sync/async Chat paths separately. Paid restoration is owned by the canonical SameDayDesk receiving workflow; the next request consumes its valid available projection without an adapter restart or a local switch.

## AgentChat sync return

Agentverse routes Chat Protocol envelopes through `https://agentverse.ai/v2/agents/proxy/submit` to the existing registered `POST /av/chat` endpoint. A caller that sets `x-uagents-connection: sync` receives the handler text as a signed ChatMessage envelope. The text is the same JSON the `SendMessage` path already returns. Without that header, the SDK acknowledges `{}` and delivers the asynchronous reply to the sender's own registered endpoint; an empty acknowledgment is not useful delivery.

The actual October5 synchronous receiving observed HTTP308 from the proxy to the exact registered HTTPS endpoint `https://agentverse-a2a-production.up.railway.app/av/chat`. Preserve the signed POST envelope and connection header for one307/308 hop only when the destination equals that declared registered endpoint. Do not follow arbitrary redirects or treat a redirect/HTTP200 alone as a completed task. Verify the reply signature, registered sender, ephemeral caller target, original session and Chat Protocol digest before interpreting the text.

The pinned native receiving recipe and guarded caller are in [Pilot's receiving record](https://github.com/epistemedeus/pilot/blob/codex/root-1005-paid-progress/overview/research/phase-20261001/agentverse-native-1005/ROOT-ADJUDICATION.md) and [receiving tool](https://github.com/epistemedeus/pilot/blob/78c1eece3cc533811dc468b3039120b8a17fdbec/tools/ops/agentverse-native-receiving.py). It received actual useful, changed-tool, invalid-input and unpaid-challenge controls with verified signed replies on October5. These are owner QA, not customer adoption or revenue. This route does not create an agent, listing, or payment.

## Env

| Name | Role |
| --- | --- |
| `AGENT_URI` | Existing Agentverse SDK URI |
| `AGENT_PUBLIC_URL` | Public JSON-RPC base URL written on the card |
| `SAMEDAYDESK_A2A_URL` | Optional catalog override; default `https://agents.samedaydesk.com/a2a/message:send` |
