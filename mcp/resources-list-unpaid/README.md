# Unpaid MCP `resources/list`

Protocol-level discovery for `epistemedeus/x402-url-extractor`. `resources/list`
and `resources/read` are unpaid. They do not call tools, send payment headers,
or settle. Paid `tools/call` and paid HTTP routes stay x402-gated elsewhere.

## Cold run

```bash
node mcp/resources-list-unpaid/cli.mjs --json
```

Starts a loopback streamable-HTTP MCP, `initialize`s, then POSTs `resources/list`
with no payment headers. Exit 0 only when the catalog is listed unpaid.

## Seeded failure

```bash
node mcp/resources-list-unpaid/cli.mjs --seeded-failure paid-list --json
```

Fixture `fixtures/seeded-paid-list.json` is an x402-MCP payment-required body
applied to `resources/list`. The checker must reject it (exit 1,
`RESOURCES_LIST_PAID`).

## Catalog

Four static discovery URIs under `mcp://x402-url-extractor/unpaid/`:

- `agent-card`
- `x402-manifest`
- `openapi`
- `skill-contract`

Each points at an existing public HTTP document. Reads return that unpaid
descriptor; they do not fetch the public URL.
