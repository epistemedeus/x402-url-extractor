# w1031 — x402 `route_absent`

An HTTP method+path that is not a registered x402 resource is `route_absent`.
Absence is not a 402 challenge, not demand, not settlement.

Cold run mounts `server.js` on loopback with `EXTRACT_BATCH_ENABLED=0` and
`LOCKFILE_PIN_DELTA_ENABLED=0`. A fake facilitator throws on verify/settle.

- Present control: unpaid `GET /extract` is HTTP 402, `accepts[].amount=5000`.
- Absent: `GET /w1031-route-absent`, flag-off `POST /extract/batch`, flag-off
  `POST /lockfile-pin-delta` are HTTP 404 with no `Payment-Required`.
- `/.well-known/x402` and `/api/actions` omit those absent routes.
  `agent-payment-policy` listing identity for them is `route_absent`.
- A `PAYMENT-SIGNATURE` on the invented path stays 404; settle/verify stay 0.

Seeded failure: a real 404 wire for `/w1031-route-absent` claimed as
demand / HTTP 402 / charged / listed is rejected.

## Verify

```bash
node tests/protocol/w1031-route-absent/check.mjs --cold
# exit 0

node tests/protocol/w1031-route-absent/check.mjs --seeded-failure
# exit 1  (route_absent classified as demand)

node --test --test-concurrency=1 tests/protocol/w1031-route-absent/*.test.mjs
```

`--live`, `--pay`, `--cdp`, `--publish` are refused (exit 2).
