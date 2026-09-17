# SameDayDesk unpaid MCP `tools/list` via OpenAI Agents

Bounded OpenAI Agents SDK example that lists SameDayDesk MCP tools over
Streamable HTTP. The advertised command connects with
`MCPServerStreamableHttp` and stops after unpaid `tools/list`.

This is not a wallet, not a paid `tools/call` client, not an agent runner, and
not a marketplace listing.

## Pins

| Pin | Value |
| --- | --- |
| OpenAI Agents SDK | `@openai/agents@0.18.0` |
| MCP client (required for Streamable HTTP) | `@modelcontextprotocol/client@2.0.0` |
| Transport class | `MCPServerStreamableHttp` |
| Live MCP URL | `https://agents.samedaydesk.com/mcp` |
| Initialize-era protocol | `2025-11-25` |

The pinned SDK may probe `server/discover` with protocol `2026-07-28` and an
`Mcp-Method` header. SameDayDesk rejects that version (HTTP 400) and the SDK
falls back to initialize-era `initialize` / `tools/list`. This example does
**not** claim `2026-07-28` dual-stack support.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/openai-agents-sds-mcp-list
npm ci --ignore-scripts
```

Requires Node.js 22 or newer. From an existing repository checkout, start with
`cd examples/openai-agents-sds-mcp-list` instead of cloning again.

## Copyable CLI

Default commands never read wallet credentials, never set `OPENAI_*` keys,
never run an `Agent`, and never call tools.

```bash
npm start
npm run list
node bin/cli.mjs
```

Require `extract` and `extract_batch` with their live input schemas. Extra
unrelated tools are accepted. Do not call them.

Optional spoofable source header (not identity, not the default):

```bash
node bin/cli.mjs --declare-source
```

## Seeded failure

A paid or mutating path is refused locally before connect:

```bash
node bin/cli.mjs --call extract
```

That prints `outcome: "refused"` and exits 2. The same refusal applies to
`--approve`, `--pay`, `--purchase`, `--wallet`, `--header`, a non-HTTPS
SameDayDesk URL, and a foreign MCP host.

## What this example does not do

- Does not import or run `Agent` / `Runner`.
- Does not send `PAYMENT-SIGNATURE`, `Authorization`, or other credentials.
- Does not transplant HTTP payment headers onto `mcp://` resources.
- Does not publish to npm or an MCP registry.
- Paying `POST /extract/batch` or `GET /extract` stays in
  [`examples/customer-x402`](../customer-x402). MCP list and HTTP purchase
  remain distinct credential scopes.

## Validate

```bash
npm test
```

Offline tests cover CLI refusals, inventory, and an injected
`MCPServerStreamableHttp` factory. The advertised `npm start` is the live
unpaid list.
