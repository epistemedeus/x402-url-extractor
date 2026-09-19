# Pin fixture: agent-payment-policy 0.12.0

Merchant, `examples/customer-x402`, and `examples/basepay-composition` still
declare `agent-payment-policy@0.12.0`. R6-04 portable evidence requires
`buyer.schemaDigest` from policy **0.13+** `inspectOutputSchema` /
`createIntent`. This pin cannot supply that digest.

Write boundary: `tests/pin/policy-0.12.0/**` only. Does not bump
`package.json`, pay, publish, or merge research PR 193 as product.

## Verify

```bash
node tests/pin/policy-0.12.0/check.mjs
# exit 0 — pins-match 0.12.0

node tests/pin/policy-0.12.0/project.mjs \
  tests/pin/policy-0.12.0/fixtures/omitted-buyer-schema-digest.json
# exit 1 — buyer_schema_digest_omitted, evidence null, pin 0.12.0

node tests/pin/policy-0.12.0/check.mjs \
  tests/pin/policy-0.12.0/fixtures/seeded-pin-drift.json
# exit 1 — pin-drift to 0.15.1

node tests/pin/policy-0.12.0/check.mjs --project \
  tests/pin/policy-0.12.0/fixtures/seeded-invented-field.json
# exit 1 — invented_receipt_field_without_live_schema (loyaltyPoints)

node tests/pin/policy-0.12.0/check.mjs --project \
  tests/pin/policy-0.12.0/fixtures/seeded-treat-absence-as-demand.json
# exit 1 — treat_absence_as_demand

node tests/pin/policy-0.12.0/check.mjs \
  tests/pin/policy-0.12.0/fixtures/seeded-empty-pin-source.json
# exit 1 — pin-source-empty

node tests/pin/policy-0.12.0/check.mjs \
  tests/pin/policy-0.12.0/fixtures/seeded-lock-integrity-missing.json
# exit 1 — lock-integrity-missing

node tests/pin/policy-0.12.0/project.mjs \
  tests/pin/policy-0.12.0/fixtures/seeded-caller-supplied-digest.json
# exit 1 — inspect_output_schema_unavailable

node --test --test-concurrency=1 tests/pin/policy-0.12.0/*.test.mjs
```
