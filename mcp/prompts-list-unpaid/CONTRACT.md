# MCP `prompts/list` unpaid — contract

Authority: MCP prompt methods as exercised by
`@modelcontextprotocol/sdk@1.30.0` `Client` over Streamable HTTP against this
repository's `mountMcp` (`mcp-server.mjs`) on loopback `POST /mcp`.

This pack is the unpaid prompt catalog and a protocol harness. It does not
pay, settle, publish, deploy, change prices or SKUs, or execute `extract`.

## Surface

| Item | Value |
|---|---|
| Transport | Streamable HTTP MCP |
| Process | local `mountMcp` from `mcp-server.mjs` |
| Path | `POST /mcp` on `http://127.0.0.1:<ephemeral>` |
| Client | official `Client` + `StreamableHTTPClientTransport` |
| Protocol | initialize-era `2025-11-25` |

Live `https://agents.samedaydesk.com/mcp` currently returns JSON-RPC `-32601`
for `prompts/list` (no prompts capability). This pack wires unpaid prompts
into `mountMcp`; it does not deploy that change.

## In scope

1. **`prompts/list`** without payment headers, `PAYMENT-SIGNATURE`, or
   `_meta["x402/payment"]`. HTTP 200 / JSON-RPC result. Catalog is the three
   public well-known skills: `web-extract`, `page-change`, `explicit-record`.
2. **`prompts/get`** of those names returns the public `SKILL.md` template.
   That is unpaid discovery, not extract execution and not authorization to
   spend.
3. **Seeded failure:** `prompts/get` name `__seeded_unknown_prompt__` must be
   rejected (MCP `-32602`). Accepting it is a conformance failure (exit 2).

## Out of scope

- Payment, settlement, wallet, facilitator live calls
- Changing tool prices or SKUs
- npm publish, marketplace submit, production deploy
- Making `tools/call` unpaid
- MCP transport `2026-07-28`

## Errors

`prompts/list` that returns HTTP 402, JSON-RPC `-32042`, or an x402
PaymentRequired body is a fail. `tools/call` without payment must still be
gated and must not run the tool handler.
