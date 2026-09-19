# x402 wrong-network

A PAYMENT-SIGNATURE whose `accepted.network` is not the advertised route
network (`eip155:8453`) must stay HTTP 402 with `No matching payment
requirements`. Facilitator `/verify` and `/settle` must not run.

This directory is the write boundary. It mounts loopback `server.js` with a
fake facilitator that would accept if called. Never pays, never xpay/CDP,
never checkout, never neo, never publish.

## Verify

```bash
node tests/protocol/wrong-network/check.mjs --cold
# exit 0

node tests/protocol/wrong-network/check.mjs --seeded-failure
# exit 1  (Sepolia payload claimed as Base settlement)

node --test --test-concurrency=1 tests/protocol/wrong-network/*.test.mjs
```

`--live`, `--pay`, `--payment`, `--neo`, `--publish`, `--checkout`, `--cdp`
are refused (exit 2).
