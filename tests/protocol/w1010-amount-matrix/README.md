# w1010 — x402 unpaid amount matrix

String-compare SameDayDesk unpaid `accepts[].amount` across HTTP 402,
MCP `tools/list` `_meta.x402.accepts[].amount`, and OpenAPI 402 text.

Pins (atomic strings, no unit conversion):

| route | amount |
| --- | --- |
| GET `/extract` | `5000` |
| GET `/read` | `5000` |
| GET `/scan` | `200000` |
| GET `/schemaforge` | `250000` |
| GET `/commerce/payment-offer-preflight` | `5000` |
| GET `/chain/transaction-receipt` | `2000` |

payTo is `0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee`. No payment headers.
Copying extract `5000` onto `/scan` is `copy_extract_onto_scan`.

This directory is the write boundary. Cold run mounts `server.js` on loopback
with a fake facilitator that refuses verify/settle.

## Verify

```bash
node tests/protocol/w1010-amount-matrix/check.mjs --cold
# exit 0

node tests/protocol/w1010-amount-matrix/check.mjs --seeded-failure
# exit 1  (copy extract 5000 onto /scan)

node --test --test-concurrency=1 tests/protocol/w1010-amount-matrix/*.test.mjs
```

`--live`, `--pay`, `--cdp`, `--publish`, `--neo` are refused (exit 2).
These paths are unpublished: they are not in `package.json` scripts.
