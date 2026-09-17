# Boundary and kill conditions

Unpaid MCP discovery **reads**. It does not publish, register, pay, or
change prices. Crossing any kill line is a failed follow of this pack,
even if the live merchant would have answered.

## Kill: publish / registry

Stop. Do not continue discovery as if it succeeded. Do not retry as a
publish.

Forbidden:

- `POST` to `https://registry.modelcontextprotocol.io/v0.1/publish`
  (or any MCP Registry publish URL)
- `mcp-publisher` / `npx @modelcontextprotocol/publisher`
- `npm publish`, Smithery publish, marketplace submit
- A2A / Global Registry registration writes
- Editing or replacing repository `server.json` in order to republish
- Treating a local `server.json` packet as a live catalog write

The official MCP Registry listing for
`io.github.epistemedeus/x402-data-gateway` is **read-only
observation**. A version label lag versus live `/mcp` is not authority
to publish. Root may publish later; this pack does not.

## Kill: payment / checkout

Forbidden during this pack:

- MCP `tools/call`
- HTTP `PAYMENT-SIGNATURE`, `X-PAYMENT`, `Authorization: Bearer`, or
  MCP `_meta["x402/payment"]` on `initialize` / `tools/list`
- `@x402/fetch` purchase, wallet unlock, facilitator verify/settle
- Checkout, SKU, or price mutation
- Sending `Mcp-Method` (header-routed MCP is not this protocol)

`tools/list` `_meta.x402.paymentRequired` means later `tools/call` is
gated. It is not a bill and not permission to attach a credential.

## Allowed (unpaid)

- `POST https://agents.samedaydesk.com/mcp` JSON-RPC `initialize`
  with `protocolVersion: "2025-11-25"`
- The same session's JSON-RPC `tools/list`
- Optional `notifications/initialized` (not required)
- Optional Inspector `tools/list` (`npx @modelcontextprotocol/inspector`)
- Reading public `GET` discovery documents (`/openapi.json`,
  `/.well-known/x402`) **without** posting payment

`goose info`, plugin-schema checks, and fixture loaders are **not** live
MCP discovery. Do not mix them with this pack.

## Protocol

Speak initialize-era `2025-11-25`. Do not send `2026-07-28`. If the
server returns `2026-07-28`, stop; this pack does not claim that
protocol.

Do not send URL credentials. Do not follow redirects on `/mcp`.
Default discovery sends no `X-SameDayDesk-Agent-Source`. A declared
source label is not identity, payment, or demand.

## Do not touch

- `neomorphic-io` (or `https://neomorphic.io/`) as a target, fixture,
  or example
- Merchant payment, replay, or catalog code outside this directory
- Production deploy, Railway, CDP credentials, or price constants
