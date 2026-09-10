# NL-RECORD-04 RESULT — Distribution repair feed

Date: 2026-09-10 (PT). Quota target: finish/push near 2026-09-10T12:48:15.801Z.

## Exact source / ref

- Repository: `epistemedeus/x402-url-extractor`
- Branch: `codex/nl-record-04-dist-feed-20260910`
- Merchant pin: `a7e2cd7a2223e2aa7e7e09eebf3695aba4731205`
- Dist08 cite pin: `ea000772cdbd6d5df7174369dcef9aa2270e5723`
- Scope: `experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed` (NEW only)

## What built

`buildDistRepairFeed` adapter: calls sibling `../05` `buildRouteRegressionReport`,
maps deltas → `repairRecommendations[]` with coverage-preserving removal rule.
Schema `pilot.nl.record.dist_repair_feed.v1`. CLI: `feed` | `validate` | `demo`.
Fixtures: positive / partial-incomplete-current / negative-forbidden.

## How to run

```sh
cd experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed
npm test
npm run demo
```

Export artifact for Dist-06: `artifacts/dist-repair-feed.positive.json`

## Acceptance

- [x] Reuses 05 (no parser rewrite); does not reimplement diagnoseConversion
- [x] Incomplete current → cannot_prove_global_removal / coveragePreserved
- [x] Forbidden SEO/traffic/intent/revenue refused
- [x] usableBy Dist-06 + distribution/08; pins recorded
- [x] Feature-branch push authorized (≠ Root publication)


## Tests (this VM)

- Command: `npm test` → **8 pass / 0 fail**
- Demo: positive ready (recommend_distribution_recheck for removed); partial → cannot_prove_global_removal ×2; negative rejected forbidden_claim
- Export: `artifacts/dist-repair-feed.positive.json`

## Commit / push

- Feature tip: `0816ddf83d81ff00d902bdbf2e8f72d387804c9d`
- Push: origin `codex/nl-record-04-dist-feed-20260910`
