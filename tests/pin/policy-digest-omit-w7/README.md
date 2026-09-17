# Pin: omit `buyer.schemaDigest` fails (w7)

Buyer pins must bind `buyer.schemaDigest` as `sha256:` plus 64 lowercase hex
characters. Omitting the field fails closed. A seller `output.schemaDigest` is
not a substitute.

The cold checker inspects the committed buyer schema at
`examples/customer-x402/fixtures/record/required-sku/schema.json` through
`agent-payment-policy` `evaluateResponseContract` and requires the digest pinned
in `pins.json`.

Never pays, publishes, checks out, or accepts `--live`.

```bash
node tests/pin/policy-digest-omit-w7/check.mjs --cold
node tests/pin/policy-digest-omit-w7/check.mjs --seeded-failure
node --test --test-concurrency=1 tests/pin/policy-digest-omit-w7/*.test.mjs
```
