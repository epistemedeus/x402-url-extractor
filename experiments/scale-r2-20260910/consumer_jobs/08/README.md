# R2-CONSUMER-JOBS-08 — Thin customer result package

Isolated experiment under `experiments/scale-r2-20260910/consumer_jobs/08` in
`epistemedeus/x402-url-extractor`.

## Outcome

Assemble independent CLI recipes into a **customer result package** with a
clean-install consumer journey. Currently **ready**: `procurement-brief`
(R2-CONSUMER-JOBS-07). Heavy slots 01–06 stay
`unavailable_pending_heavy` (distinct from empty/no-users) until exact Heavy
artifacts return — this thin package does **not** invent demo outputs for them.

## Constraints

- Offline / fixtures only; **never** invent Heavy 01–06 artifacts
- No paid calls, investment recommendations, ranking, escrow, or custody claims
- Feature-branch source/tests only — Root owns merge, publication, and paid actions
- Prefer sibling `../07` CLI when present on this branch

## Schema

- Package: `x402.r2.consumer.customer_result_package.v1`
- Request: `x402.r2.consumer.customer_result_request.v1`
- Manifest: `x402.r2.consumer.recipe_manifest.v1`
- Package status: `ready` | `partial` | `rejected`
- Recipe status: `ready` | `unavailable_pending_heavy` | `unknown`

## Quick start

See `CONSUMER.md` and `DEMO.md`.

```sh
cd experiments/scale-r2-20260910/consumer_jobs/08
npm test
npm run demo
npm run journey
node src/cli.mjs manifest
node src/cli.mjs assemble fixtures/positive-journey.json
```

## Mutation boundary

Exact feature-branch source only. Do not merge/publish/pay from this package.
