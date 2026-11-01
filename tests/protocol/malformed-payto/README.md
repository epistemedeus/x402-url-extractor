# x402 malformed-payto protocol suite

Loopback protocol tests for x402 v2 exact `payTo`.

- Unpaid `402` exact accepts must advertise a `0x`-prefixed 40-hex EVM `payTo`.
- A payment payload with malformed `authorization.to` must not deliver or settle.
- A payload whose `accepted.payTo` is empty, a `payto://` URI, ENS, URL, or
  wrong-length hex must not deliver or settle.
- `decodeReplayPayment` fails closed when `accepted.payTo` is not an EVM address.
- Loopback `server.js` plus a payTo-aware fake facilitator. Never pays, never
  calls xpay/CDP, never mutates checkout, and does not touch neomorphic-io.

```
node tests/protocol/malformed-payto/check.mjs --cold
node tests/protocol/malformed-payto/check.mjs --seeded-failure
node --test --test-concurrency=1 tests/protocol/malformed-payto/*.test.mjs
```

`--seeded-failure` loads `fixtures/reject/seeded-malformed-payto-accepted.json`
(malformed `authorization.to` claimed as paid `200`). The guard must reject it
(`malformed_payto_accepted`, exit 1). Exit 2 means the seed was wrongly accepted.
