# Fixtures

- `next.json`: a third observation for the same two sources as `examples/customer-x402/fixtures/page-change/c1/after.json`. Only the alpha title changed. It is synthetic and is never fetched.

The recipes use `examples/customer-x402/fixtures/page-change/c1/before.json` and `c1/after.json` for the first step and `next.json` for the continued step.
- `other-sources.json`: same shape as `next.json` but for two different source identities. Continuing a chain with it is refused with `continuation_subject_mismatch`.
