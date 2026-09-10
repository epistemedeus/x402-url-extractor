# DEMO — R2-RECORD-JOBS-05

Truthful demo commands and expected shapes. Synthetic fixtures only.
Not a claim about the entire internet.

## Commands

```sh
cd experiments/scale-r2-20260910/record_jobs/05
node src/cli.mjs demo
node src/cli.mjs report fixtures/positive.json
node src/cli.mjs report fixtures/negative-malformed.json
node src/cli.mjs report fixtures/partial-incomplete.json
npm test
```

## Expected demo summary shape

```json
{
  "schema": "x402.r2.record.route_regression_report.v1",
  "demo": true,
  "note": "Synthetic fixtures only; no live crawl; not a claim about the entire internet.",
  "results": {
    "positive.json": {
      "status": "ready",
      "deltaCounts": {
        "unchanged": 1,
        "removed": 1,
        "redirected": 1,
        "inaccessible": 2,
        "restored": 1,
        "status_changed": 0,
        "added": 1
      },
      "hasSeoRank": false,
      "hasTrafficProjection": false,
      "hasInvestmentRecommendation": false,
      "hasSiteHealthScore": false,
      "scopeNotePresent": true
    },
    "partial-incomplete.json": {
      "status": "partial_input"
    },
    "negative-malformed.json": {
      "status": "rejected"
    }
  }
}
```

## Expected positive report (truncated)

```json
{
  "schema": "x402.r2.record.route_regression_report.v1",
  "status": "ready",
  "diffs": [
    { "routeKey": "/", "delta": "unchanged" },
    { "routeKey": "/changelog", "delta": "added" },
    { "routeKey": "/docs", "delta": "redirected" },
    { "routeKey": "/legacy", "delta": "inaccessible" },
    { "routeKey": "/maintenance", "delta": "restored" },
    { "routeKey": "/old-blog", "delta": "removed" },
    { "routeKey": "/pricing", "delta": "inaccessible" }
  ],
  "scopeNote": "Report covers only the supplied baseline+current route snapshot pair. This is not a claim about the entire internet."
}
```

Rejected inputs exit code `1` for `report`; demo always exits `0` after reporting.
