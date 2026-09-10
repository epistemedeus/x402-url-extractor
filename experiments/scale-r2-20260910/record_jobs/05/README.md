# R2-RECORD-JOBS-05 — Public route regression report

Isolated experiment under `experiments/scale-r2-20260910/record_jobs/05` in
`epistemedeus/x402-url-extractor`.

## Outcome

Compare **two caller-supplied** route snapshots (baseline + current). Classify
per-route deltas: `unchanged` · `removed` · `redirected` · `inaccessible` ·
`restored` · `status_changed` · `added`.

## Constraints

- Snapshot-pair compare only — **never** crawl live sites; never invent unobserved routes
- Explicit `scopeNote`: report is **not** a claim about the entire internet
- No SEO rank, traffic projection, invest advice, or site-health-score marketing claims
- Synthetic / public fixtures only
- Feature-branch source/tests only — Root owns merge, publication, and paid actions

## Classification (precise)

| Delta | Meaning |
| --- | --- |
| `removed` | Present in baseline, absent in current |
| `added` | Present in current only |
| `redirected` | `finalUrl` / redirect location changed, or became 3xx with new location |
| `inaccessible` | Now 401/403/404/410/5xx/timeout/dns/error while baseline was reachable |
| `restored` | Was inaccessible in baseline, now reachable |
| `status_changed` | Status code changed without redirect/inaccessible/restored |
| `unchanged` | No material route delta |

## Schema

- Input: `x402.r2.record.route_regression_input.v1`
- Report: `x402.r2.record.route_regression_report.v1`
- Status: `ready` | `partial_input` | `rejected`

## Quick start

See `CONSUMER.md` and `DEMO.md`.

```sh
cd experiments/scale-r2-20260910/record_jobs/05
npm test
npm run demo
node src/cli.mjs report fixtures/positive.json
```

## Mutation boundary

Exact feature-branch source only. Do not merge/publish/pay from this package.
