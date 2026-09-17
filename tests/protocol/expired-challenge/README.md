# x402 expired-challenge protocol suite

Loopback protocol tests for x402 v2 exact/EIP-3009 challenge expiry.

- Unpaid `402` exact accepts must advertise `maxTimeoutSeconds` in `1..300`.
- A payment payload with `validBefore` in the past must not deliver or settle.
- A payload with `validAfter` in the future must not deliver or settle.
- Remaining validity above the challenge timeout is unbounded and must not deliver.
- Loopback `server.js` may reject an already-expired payload as HTTP 409
  `payment_replay_expired` (idempotency-replay `validUntilMs`) before facilitator
  `/verify`. That is a valid fail-closed path. Not-yet-valid payloads reach
  facilitator verify and return HTTP 402
  `invalid_exact_evm_payload_authorization_valid_after`.

This suite starts `server.js` against an expiry-aware fake facilitator on
`127.0.0.1`. It never pays, never calls xpay/CDP, never mutates checkout, and
does not touch neomorphic-io.

```
node tests/protocol/expired-challenge/check.mjs --cold
node tests/protocol/expired-challenge/check.mjs --seeded-failure
node --test --test-concurrency=1 tests/protocol/expired-challenge/*.test.mjs
```

`--seeded-failure` loads `fixtures/reject/seeded-expired-accepted.json` (expired
`validBefore` claimed as paid `200`). The guard must reject it (`expired_challenge_accepted`,
exit 1). Exit 2 means the seed was wrongly accepted.
