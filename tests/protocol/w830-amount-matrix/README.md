# w830 — x402 unpaid amount matrix

String-compare SameDayDesk unpaid `accepts[].amount` across HTTP 402,
MCP `tools/list` `_meta.x402.accepts[].amount`, OpenAPI 402 text, and
`.well-known/x402` items. Amounts are atomic strings. No unit conversion.

Pins:

| route | amount |
| --- | --- |
| GET `/extract` | `5000` |
| GET `/read` | `5000` |
| GET `/scan` | `200000` |
| GET `/schemaforge` | `250000` |
| GET `/enrich` | `50000` |
| GET `/defi/morpho-position` | `20000` |
| GET `/defi/morpho-protection` | `100000` |
| GET `/commerce/payment-offer-preflight` | `5000` |
| GET `/chain/transaction-receipt` | `2000` |
| GET `/commerce/seller-integrity-audit` | `10000` |

payTo is `0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee`. No payment headers.

Copying extract `5000` onto `/scan` is the designated seeded failure.

## Verify

```bash
node tests/protocol/w830-amount-matrix/check.mjs --cold
# exit 0

node tests/protocol/w830-amount-matrix/check.mjs --seeded-failure
# exit 1  (copy extract 5000 onto /scan → amount_mismatch)

node --test --test-concurrency=1 tests/protocol/w830-amount-matrix/*.test.mjs
```

`--live`, `--pay`, `--neo`, `--publish`, `--cdp` are refused (exit 2).
This directory is the write boundary. Unpublished: not in `package.json` scripts.
