# R2-CONSUMER-JOBS-08 — Thin customer result package (S152 compose)

Isolated experiment under `experiments/scale-r2-20260910/consumer_jobs/08` in
`epistemedeus/x402-url-extractor`.

## Outcome (S152 reality — do not invent away)

Assemble independent CLI recipes into a **customer result package** with a
clean-install consumer journey.

**Ready recipes wired** (manifest `readyCount: 7`):

| id | jobRef | Runner |
|---|---|---|
| migration-checklist | R2-CONSUMER-JOBS-01 | S137 Heavy CLI |
| release-brief | R2-CONSUMER-JOBS-02 | S137 Heavy CLI |
| table-reconcile | R2-CONSUMER-JOBS-03 | S137 Heavy CLI |
| link-index | R2-CONSUMER-JOBS-04 | S137 Heavy CLI |
| replay-pack | R2-CONSUMER-JOBS-05 | S137 Heavy CLI |
| freshness-receipt | R2-CONSUMER-JOBS-06 | S137 Heavy CLI |
| procurement-brief | R2-CONSUMER-JOBS-07 | sibling `../07` |

Positive integrated journey package status is typically **`partial`** (not a
ready package). Exact Heavy decisions on synthetic positives:

| id | slot status | Heavy decision |
|---|---|---|
| migration-checklist | ready | pass |
| release-brief | ready | pass |
| table-reconcile | failed | fail |
| link-index | failed | fail |
| replay-pack | failed | fail |
| freshness-receipt | ready | pass |
| procurement-brief | ready | (07 brief ready) |

`table-reconcile` / `link-index` / `replay-pack` CLI fail are **external Heavy
defects** recorded as returned — they are **not** `unavailable_pending_heavy`.
Do not claim a ready package or invent Heavy pass. Heavy CLI fixes belong to
Heavy parent (post-S153), not this thin package.

Acquisition operators: see sibling `../compose/ACQUISITION.md` and
`node ../compose/src/cli.mjs status`.

## Constraints

- Offline / fixtures only; never invent Heavy pass packets
- No paid calls, investment recommendations, ranking, escrow, or custody claims
- Feature-branch source/tests only — Root owns merge, publication, and paid actions
- Fixture URLs/commands stay **data** (never auto-fetched)
- Prefer sibling `../07` CLI and vendored S137 pack when present

## Schema

- Package: `x402.r2.consumer.customer_result_package.v1`
- Request: `x402.r2.consumer.customer_result_request.v1`
- Manifest: `x402.r2.consumer.recipe_manifest.v1`
- Heavy packet: `s137.consumer-evidence.packet.v1`
- Acquisition status: `x402.r2.consumer.acquisition_status.v1` (compose CLI)
- Package status: `ready` | `partial` | `rejected`
- Recipe slot status includes: `ready` | `failed` | `conflict` | `partial` | `unknown` | `rejected` | `unavailable_pending_heavy` (legacy only when CLI/pack truly missing)

## Quick start

See `CONSUMER.md`, `DEMO.md`, and `../compose/ACQUISITION.md`.

```sh
cd experiments/scale-r2-20260910/consumer_jobs/08
npm test
npm run demo
npm run journey
node src/cli.mjs manifest
node src/cli.mjs assemble fixtures/positive-journey.json
node ../compose/src/cli.mjs status --journey demo-out/s152/journey.json
```

## Mutation boundary

Exact feature-branch source only. Do not merge/publish/pay from this package.
