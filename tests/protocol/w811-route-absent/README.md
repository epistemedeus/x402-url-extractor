# w811 — x402 `route_absent`

An undeclared path is **route_absent**. It is not HTTP 402, not
`PAYMENT-REQUIRED`, and not facilitator verify/settle.

Declared `GET /extract` still returns unpaid HTTP 402, so the harness is not a
blanket 404. A case-folded `GET /EXTRACT` is the same declared route, not
`route_absent`. Declared `GET /healthz` is a present unpaid surface, not
`route_absent`.

Catalogs that list the origin on a different path (`/read` while the caller
asks for `/extract`) report `priceObservation.status=route_absent` and finding
`origin_found_expected_route_absent` via `agentDiscoverabilityAudit`.

This directory is the write boundary. It mounts `server.js` on loopback with a
fake facilitator.

## Verify

```bash
node tests/protocol/w811-route-absent/check.mjs --cold
# exit 0

node tests/protocol/w811-route-absent/check.mjs --seeded-failure
# exit 1  (absent path classified as HTTP 402 / payable / settled)

node --test --test-concurrency=1 tests/protocol/w811-route-absent/*.test.mjs
```

`--live`, `--pay`, `--cdp`, `--publish`, `--neo` are refused (exit 2).
