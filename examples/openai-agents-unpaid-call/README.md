# SameDayDesk OpenAI Agents unpaid-call example

Credential-free demonstration that an unpaid MCP `tools/call` made through the
OpenAI Agents SDK is a JSON-RPC **result** with `isError: true` and x402
`PaymentRequired` `structuredContent`.

This is not a wallet, not a paid OpenAI run, not a live merchant client, and
not authorization to retry with `x402/payment`.

| Pin | Value |
| --- | --- |
| SDK | `@openai/agents@0.18.0` |
| Method | `MCPServerStreamableHttp.callToolResult` |
| Outcome | `unpaid_call_is_error` (`isError: true`) |
| Default transport | loopback mock Streamable HTTP MCP (`http://127.0.0.1`) |

`callTool()` returns the MCP `content` array only and **drops** `isError`.
Use `callToolResult()` so the unpaid challenge stays a model-visible tool
error rather than a protocol error or a silent success.

## Install

```bash
git clone https://github.com/epistemedeus/x402-url-extractor.git
cd x402-url-extractor/examples/openai-agents-unpaid-call
npm ci --ignore-scripts
```

Requires Node.js 22 or newer. From an existing checkout, start with
`cd examples/openai-agents-unpaid-call`. No `OPENAI_API_KEY`, wallet, or
network beyond loopback is required.

## Copyable CLI

Default commands never read credentials, sign, send payment metadata, or call
a public merchant. They start a loopback MCP mock and invoke the real OpenAI
Agents `callToolResult` without payment.

```bash
npm start
node bin/cli.mjs
```

Offline recorded `callToolResult` shape:

```bash
node bin/cli.mjs --fixture ./fixtures/unpaid-call-is-error.json
```

## Seeded failure

`isError: false` is not an unpaid challenge and is not `paid_success`:

```bash
npm run fail
node bin/cli.mjs --fixture ./fixtures/hostile/is-error-false.json
```

That command must exit `1`. Other rejected shapes:

```bash
node bin/cli.mjs --fixture ./fixtures/hostile/protocol-error-402.json
node bin/cli.mjs --fixture ./fixtures/hostile/calltool-content-only.json
node bin/cli.mjs --fixture ./fixtures/hostile/payment-request-meta.json
```

`--live`, `--pay`, `--approve`, `--payment`, `--neo`, and `--publish` are
refused.

## Tests

```bash
npm test
```

Default tests are offline. The loopback path uses `@openai/agents` against
`127.0.0.1` and does not call `https://agents.samedaydesk.com`.

## What the report will not say

- `isError: true` is not paid output and not settlement.
- A JSON-RPC error (including code `402`) is not this outcome.
- `callTool()` content-only results do not preserve `isError`.
- Attaching `x402/payment` is outside this example.
- Loopback mock accepts are not live merchant terms.

## Layout

- `bin/cli.mjs` — copyable CLI
- `src/classify.mjs` — unpaid `isError:true` contract
- `src/loopback.mjs` — real SDK call against the mock
- `src/mock-mcp.mjs` — loopback Streamable HTTP MCP
- `fixtures/unpaid-call-is-error.json` — recorded success shape
- `fixtures/hostile/` — seeded failures
