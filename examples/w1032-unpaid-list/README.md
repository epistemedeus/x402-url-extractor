# SameDayDesk W1032 unpaid `tools/list`

Unpaid MCP discovery against the live SameDayDesk streamable-HTTP endpoint at
`https://agents.samedaydesk.com/mcp`. This example runs `initialize` then
`tools/list` and stops. It does not call tools, sign, pay, publish, or use
neo.

Work item **w1032**. Write boundary is this directory only.

## Pins

| Pin | Value |
| --- | --- |
| MCP URL | `https://agents.samedaydesk.com/mcp` |
| Transport | `streamable-http` |
| Protocol | `2025-11-25` |
| Required tools | `extract`, `extract_batch` |
| Extra tools | accepted |
| Dependencies | none (Node 22 stdlib) |

GET `/mcp` is a JSON discovery document (`method: POST`). It is not
`tools/list`. Live unpaid discovery is POST `initialize` then POST
`tools/list`. Tool metadata is not authorization.

## Install

Node.js 22 or newer. No extra npm packages.

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/w1032-unpaid-list
node bin/cli.mjs --json
```

From an existing checkout, start with `cd examples/w1032-unpaid-list`.

## Cold unpaid list (default)

Default commands never send `tools/call`, payment headers, `Mcp-Method`,
neo hosts, or publish requests. They do not send protocol `2026-07-28`.

```bash
node bin/cli.mjs
node bin/cli.mjs --json
```

Require `extract` and `extract_batch`. Extra unrelated tools are fine. Do not
call them.

## Seeded failure

Offline hostile inventory that omits `extract` and claims success. The product
must reject it.

```bash
node bin/cli.mjs --seeded-failure --json
```

Expected: exit **1**, `error.code: SEED_REJECT`,
`seeded.false-accept.missing-extract`. Other refused recordings:

```bash
node bin/cli.mjs --fixture ./fixtures/seeded/tools-call-attempt.json --json
node bin/cli.mjs --fixture ./fixtures/seeded/payment-header.json --json
node bin/cli.mjs --fixture ./fixtures/seeded/neo-host.json --json
node bin/cli.mjs --fixture ./fixtures/seeded/publish-attempt.json --json
```

CLI flags refused before any network:

```bash
node bin/cli.mjs --call extract
node bin/cli.mjs --pay
node bin/cli.mjs --publish
node bin/cli.mjs --neo
```

## Three different checks

Do not mix these:

1. Config read: `fixtures/mcp.json` only. No MCP connection.
2. Seeded failure: designated missing-`extract` fixture. Offline.
3. Live unpaid discovery: POST `initialize` then `tools/list` on
   `https://agents.samedaydesk.com/mcp`. Require `extract` and
   `extract_batch`. Extra tools are accepted.

`npm test` runs a loopback mock, the seeded rejection, boundary refusals, and
the live unpaid list. Loopback `--url http://127.0.0.1:<port>/mcp` is
test-only.

## Not this example

- Not a paid `tools/call`
- Not a wallet, signer, or `@x402/fetch` customer
- Not protocol `2026-07-28` and not `Mcp-Method`
- Not an MCP Registry, npm, or marketplace publish
- Not neo
- Not a default source header (`X-SameDayDesk-Agent-Source` is unset)

HTTP customer preflight and explicitly authorized purchase stay in
[`examples/customer-x402`](../customer-x402). This package does not become
payment-capable from that example. MCP and HTTP credential scopes remain
distinct.

## License

MIT. Same license as `epistemedeus/x402-url-extractor`.
