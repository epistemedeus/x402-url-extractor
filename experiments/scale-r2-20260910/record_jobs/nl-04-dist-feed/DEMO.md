# DEMO — NL-RECORD-04

```sh
cd experiments/scale-r2-20260910/record_jobs/nl-04-dist-feed
node src/cli.mjs demo
node src/cli.mjs feed fixtures/positive.json
node src/cli.mjs feed fixtures/partial-incomplete-current.json
npm test
```

## Expected

| Fixture | status | key recommendation |
| --- | --- | --- |
| positive.json | ready | removed → `recommend_distribution_recheck` |
| partial-incomplete-current.json | partial_input | removed → `cannot_prove_global_removal` (coveragePreserved) |
| negative-forbidden.json | rejected | forbidden_claim |

Export: `artifacts/dist-repair-feed.positive.json` for NL-DISTRIBUTION-06.
