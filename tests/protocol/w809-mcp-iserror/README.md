# w809 — x402 MCP `isError`

Unpaid SDS `POST /mcp` `tools/call extract` is HTTP 200 JSON-RPC **result**
with `isError: true` and a PaymentRequired body (`resource.url=mcp://tool/extract`,
`accepts[].amount=5000`). That isError flag is a challenge, not settlement.

It is not HTTP 402, not JSON-RPC error `-32042`, not snake_case `is_error`,
and not extract delivery. No `Payment-Required` header. No `PAYMENT-SIGNATURE`.

This directory is the write boundary. Cold run mounts `mcp-server.mjs` and
loopback `server.js` with a fake facilitator that refuses verify/settle.

## Verify

```bash
node tests/protocol/w809-mcp-iserror/check.mjs --cold
# exit 0

node tests/protocol/w809-mcp-iserror/check.mjs --seeded-failure
# exit 1  (HTTP 200 isError classified as charged/paid delivery)

node --test --test-concurrency=1 tests/protocol/w809-mcp-iserror/*.test.mjs
```

`--live`, `--pay`, `--payment`, `--checkout`, `--cdp`, `--publish`, `--neo` are refused (exit 2).
`--help --live` is refused, not help.
