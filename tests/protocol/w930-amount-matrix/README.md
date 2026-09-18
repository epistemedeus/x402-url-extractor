# w930 unpaid x402 amount matrix (unpublished)

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

Wave `w930` is unpublished: not in `package.json` scripts.

## Check (fixtures)

```bash
node tests/protocol/w930-amount-matrix/check.mjs canonical
# exit 0

node tests/protocol/w930-amount-matrix/check.mjs --seeded-failure
# exit 1, codes include amount_mismatch / copy_extract_onto_scan

node tests/protocol/w930-amount-matrix/check.mjs seeded-invented-field
# exit 1, invented_receipt_field_without_live_schema

node tests/protocol/w930-amount-matrix/check.mjs treat-absence-as-demand
# exit 1, treat_absence_as_demand
```

## Cold run (local merchant, unpaid)

```bash
node tests/protocol/w930-amount-matrix/check.mjs --cold
node tests/protocol/w930-amount-matrix/cold-run.mjs
node --test tests/protocol/w930-amount-matrix/w930-amount-matrix.test.mjs
```

`--live`, `--pay`, `--cdp`, `--publish`, `--neo`, and bazaar-tracker refresh flags are refused.
