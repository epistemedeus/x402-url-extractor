# Agentverse A2A adapter

This process is a discovery-only JSON-RPC 1.0 bridge. It does not price, sign, pay, or invoke SameDayDesk tools. The first-party catalog remains `a2a-storefront.mjs` (`A2A_VERSION = "1.0"`).

## Why `protocol_version` must be set

`a2a-sdk[http-server]==1.1.2` JSON-RPC handlers are `@validate_version("1.0")`. Missing `A2A-Version` is treated as `0.3` and rejected. `create_jsonrpc_routes(..., enable_v0_3_compat=False)` is required: `message/send` and `role: "user"` are not this server.

If `AgentInterface.protocol_version` is left empty, `agent_card_to_dict` merges v0.3 compat fields and advertises top-level `protocolVersion: "0.3"`. Clients that follow the card then send 0.3 shapes and fail against `lf.a2a.v1` `SendMessage`. Set the interface to `"1.0"` so the card matches the handlers.

## Operator check after deploy

No new Agentverse account, key, or registration. Redeploy this adapter only.

```bash
curl -sS "$PUBLIC_URL/.well-known/agent-card.json"
```

Expect `supportedInterfaces[0].protocolBinding` = `JSONRPC`, `protocolVersion` = `1.0`, and no top-level `protocolVersion` of `0.3`. JSON-RPC is `POST $PUBLIC_URL/` with header `A2A-Version: 1.0`, method `SendMessage`, and `message.role` = `ROLE_USER`.

Discovery returns the live seller-integrity audit `route` / `priceAtomicUsdc` / `exampleUrl`. Callers pay the merchant URL themselves.

## Env

| Name | Role |
| --- | --- |
| `AGENT_URI` | Existing Agentverse SDK URI |
| `AGENT_PUBLIC_URL` | Public JSON-RPC base URL written on the card |
| `SAMEDAYDESK_A2A_URL` | Optional catalog override; default `https://agents.samedaydesk.com/a2a/message:send` |
