# w910 — x402 unpaid amount matrix

Unpaid SDS 402 amounts are canonical **integer strings**. String-compare
`accepts[].amount` across HTTP 402, MCP `tools/list` `_meta.x402`, and
well-known items, and string-compare the OpenAPI 402 USD token.

Pins (SDS 1.23.49, Base USDC, never pay):

| Route | MCP tool | amount | OpenAPI 402 |
|---|---|---|---|
| `GET /extract` | `extract` | `"5000"` | `$0.005` |
| `GET /scan` | `scan` | `"200000"` | `$0.20` |
| `GET /chain/transaction-receipt` | `transaction_receipt` | `"2000"` | `$0.002` |

`"5000"` is not `5000`, `"5000.0"`, `"5e3"`, or `"05000"`. HTTP 402 is an
offer, not settlement. Missing routes are not demand.

This directory is the write boundary. Cold run mounts `server.js` on
loopback with a fake facilitator that 500s verify/settle.

## Verify

```bash
node tests/protocol/w910-amount-matrix/check.mjs --cold
# exit 0

node tests/protocol/w910-amount-matrix/check.mjs --seeded-failure
# exit 1  (scan amount "5000" is not the "200000" pin)

node --test --test-concurrency=1 tests/protocol/w910-amount-matrix/*.test.mjs
```

`--live`, `--pay`, `--cdp`, `--publish`, `--neo` are refused (exit 2).
