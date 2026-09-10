# S155 kit demo

## Commands

```sh
cd experiments/scale-r2-20260910/record_jobs/kit-s155
node src/cli.mjs demo
# or
node src/cli.mjs journey
```

## Expected summary shape

- `cleanInstallOk: true`
- `exampleStatus: ready` (openapi, pricing, csv, rss, route, meta)
- `partialStatus: partial` (missing native sibling)
- `refusalStatus: rejected` (forbidden claim)
- `csvProbeAllPass: true`
- `hasInvestmentRecommendation: false`

## Artifacts (`demo-out/`)

- `journey.json` — full ONE journey packet
- `manifest.json` — kit job manifest + Heavy pin
- `clean-install.json`, `example.json`, `native-extras.json`
- `partial.json`, `partial-missing-fixture.json`
- `refusal-forbidden.json`, `refusal-unknown.json`, `refusal-malformed.json`
- `csv-s154-probe.json` — wrapper evidence of S154 CSV semantics

## Notes

- Fixtures come from Heavy `fixtures/{openapi,pricing,csv,rss}/` and native `fixtures/positive.json`.
- Heavy pin: `65ce1867` (S154). CSV included — not held.
- Feature-branch only; ≠ Root publication.
