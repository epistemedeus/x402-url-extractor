# NL-RECORD-04 — Distribution repair feed

Isolated experiment under `experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed`
in `epistemedeus/x402-url-extractor`.

## Outcome

Map **two caller-supplied route snapshots** (via sibling `record_jobs/05`
`buildRouteRegressionReport`) into a **deterministic repair recommendation feed**
consumable by **NL-DISTRIBUTION-06** / `distribution/08`.

Schema: `pilot.nl.record.dist_repair_feed.v1`

## Coverage rule (hard)

Absence in an **incomplete** current capture **cannot prove globally removed**.
Such `removed` deltas map to `cannot_prove_global_removal` /
`recheck_with_complete_capture` with `coveragePreserved: true` and low confidence.

## Constraints

- Wrapper/adapter only — **reuses** `../05` parsers; does **not** reimplement
  `diagnoseConversion`
- No crawler; no SEO/traffic/ranking invention
- Forbidden fields: union of record_jobs/05 + dist08 intent/revenue forbids
- Feature-branch source/tests only — Root owns merge/publication

## Quick start

```sh
cd experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed
npm test
npm run demo
node src/cli.mjs feed fixtures/positive.json
```

Export artifact (demo): `artifacts/dist-repair-feed.positive.json`

## Pins

See `PINS.md` — merchant `a7e2cd7…` (record 05) + SDD `ea000772…` (dist 08).
