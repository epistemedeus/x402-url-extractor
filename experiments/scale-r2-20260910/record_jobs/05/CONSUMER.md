# Fresh-consumer instructions — R2-RECORD-JOBS-05

Literal steps for a new consumer. No live crawl. Synthetic fixtures only.
Report covers **only** the supplied baseline+current snapshot pair — not the entire internet.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/record_jobs/05
```

Requires Node ≥ 20. No `npm install` needed (pure Node ESM, zero dependencies).

## 2. Run the focused test suite

```sh
npm test
# equivalent: node --test tests/*.test.mjs
```

Expect positive / negative / partial cases to pass.

## 3. Run the truthful demo

```sh
npm run demo
# equivalent: node src/cli.mjs demo
```

Demo walks all fixtures and prints status + delta counts. It never emits SEO
rank, traffic projection, invest advice, or site health score.

## 4. Build a report from a fixture

```sh
node src/cli.mjs report fixtures/positive.json
node src/cli.mjs report fixtures/partial-incomplete.json
```

Or pipe JSON on stdin:

```sh
cat fixtures/positive.json | node src/cli.mjs report -
```

## 5. Validate input only

```sh
node src/cli.mjs validate fixtures/positive.json
```

## 6. Supply your own snapshot pair

Provide JSON with:

- `reportId` (string)
- `baseline` — `{ label?, capturedAt?, routes: [...] }`
- `current` — `{ label?, capturedAt?, routes: [...] }`
- Each route observation: `url` and/or `path`, optional `status`/`statusCode`,
  optional `finalUrl`/`redirectLocation`, optional `accessibility`
  (`ok`|`forbidden`|`timeout`|`dns`|`error`), optional `title`/`etag`/`contentHash`

Forbidden on any object: `seoRank`, `trafficProjection`, `investmentRecommendation`,
`siteHealthScore`, and related fields (see `src/constants.mjs` `FORBIDDEN_FIELDS`).

## What you get

A report with `diffs[]` (per-route delta + baseline/current summaries) and a
factual `summary.deltaCounts`. Always includes `scopeNote`. **No** SEO / traffic /
invest / site-health marketing fields.
