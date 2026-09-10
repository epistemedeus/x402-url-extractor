# Fresh-consumer instructions — NL-RECORD-04

Literal steps. Synthetic fixtures only. No live crawl.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed
```

Requires Node ≥ 20. Zero dependencies. Sibling `../05` must be present.

## 2. Test

```sh
npm test
```

## 3. Demo (writes Dist-06 export artifact)

```sh
npm run demo
# → artifacts/dist-repair-feed.positive.json
```

## 4. Build a feed

```sh
node src/cli.mjs feed fixtures/positive.json
node src/cli.mjs feed fixtures/partial-incomplete-current.json
```

Or wrap:

```json
{
  "routeRegressionInput": { "baseline": {}, "current": {}, "reportId": "…" },
  "distributionCite": { "pin": "ea000772…", "note": "cite-only" }
}
```

## 5. Validate a feed document

```sh
node src/cli.mjs feed fixtures/positive.json > /tmp/feed.json
node src/cli.mjs validate /tmp/feed.json
```

## What Dist-06 should read

- `schema`: `pilot.nl.record.dist_repair_feed.v1`
- `repairRecommendations[]`: `{ routeKey, delta, recommendation, confidence, coveragePreserved, notes }`
- `currentCaptureIncomplete` + `coveragePreserved` — honor cannot-prove-removal
- `usableBy`: `["NL-DISTRIBUTION-06","distribution/08"]`
- `pins` + `routeReportSummary`

Never invent SEO/traffic/ranking/revenue from this feed.
