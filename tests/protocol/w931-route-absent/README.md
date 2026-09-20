# w931 — x402 `route_absent`

`route_absent` is a checked miss. It is not demand, not a matched
listing, not HTTP 402, and not settlement.

Two unpaid surfaces:

1. `agent-discoverability-audit.mjs` — catalogs with no exact
   `/lockfile-pin-delta` records still report
   `priceObservation.status=route_absent` and
   `identityObservation.status=route_absent` (`decision=absent`).
   An origin listed on `/extract` with the requested lockfile route
   missing is `origin_found_expected_route_absent`, still
   `route_absent` for the requested route.
2. Flag-off `server.js` — `LOCKFILE_PIN_DELTA_ENABLED` defaults off.
   Unpaid `POST /lockfile-pin-delta` is HTTP **404**, omitted from
   OpenAPI / `/api/actions` / `/.well-known/x402`. Control
   `GET /extract` stays unpaid HTTP **402**. Facilitator verify/settle
   stay 0. No `Payment-Required` header. No `PAYMENT-SIGNATURE`.

This directory is the write boundary.

## Verify

```bash
node tests/protocol/w931-route-absent/check.mjs --cold
# exit 0

node tests/protocol/w931-route-absent/check.mjs --seeded-failure
# exit 1  (route_absent classified as demand)

node --test --test-concurrency=1 tests/protocol/w931-route-absent/*.test.mjs
```

`--live`, `--pay`, `--cdp`, `--publish`, `--neo` are refused (exit 2).
