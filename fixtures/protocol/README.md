# x402 unpaid 402 protocol fixtures

Conformance corpus for **unpaid** x402 v2 `PaymentRequired` only.

- HTTP: status `402` + `PAYMENT-REQUIRED` (base64 JSON). No `PAYMENT-SIGNATURE` on the request. No `PAYMENT-RESPONSE` / `PAYMENT-RECEIPT` on the response.
- MCP: `tools/call` without `_meta["x402/payment"]` returns `isError: true` and the same `PaymentRequired` object.

This directory does not settle, sign, pay, or call a facilitator.

## Layout

| Path | Role |
| --- | --- |
| `unpaid/` | Fixtures that must classify as unpaid 402 |
| `reject/` | Seeded failures, including paid-as-unpaid |
| `manifest.json` | Index with expected verdicts |

## Verify

```bash
node --test tests/protocol/unpaid-402.test.mjs
node tests/protocol/classify-unpaid-402.mjs --all
node tests/protocol/classify-unpaid-402.mjs --strict-unpaid fixtures/protocol/reject/paid-as-unpaid-http-200-settlement.json
```

The last command must exit non-zero: a paid HTTP 200 `PAYMENT-RESPONSE` is not an unpaid 402.

Optional live probe (credential-free GET, never pays):

```bash
node tests/protocol/probe-live-unpaid-402.mjs
```
