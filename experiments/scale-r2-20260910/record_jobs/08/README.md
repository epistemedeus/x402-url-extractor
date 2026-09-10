# R2-RECORD-JOBS-08 — Recurring job bundle

Isolated experiment under `experiments/scale-r2-20260910/record_jobs/08` in
`epistemedeus/x402-url-extractor`.

## Outcome

Package the **distinct useful record jobs** (native Pilot Source/Record slots
**05..07**: route regression, deadline calendar, dependency footprint) with
**real public / synthetic input pairs** and **reproducible outputs** over
existing customer tooling.

Heavy slots **01..04** appear only as catalog stubs:
`owned_by_heavy` / `not_bundled_here`. This package does **not** copy or rebuild
Heavy artifacts.

## Constraints

- Offline / fixtures only; **never** invent job outputs when a sibling is missing
- No live paid calls; no crawl of the whole internet
- No buyers/revenue invention, SEO/traffic/invest advice, security certification,
  or legal advice
- Feature-branch source/tests only — Root owns merge, publication, and paid actions

## Sibling BOUNDARY

Prefer dynamic import of sibling `src/index.mjs` when present:

1. Absolute Pilot VM worktrees (defaults in `src/constants.mjs`)
2. Relative `../05`, `../06`, `../07` when co-located
3. Else embedded fixtures under `fixtures/jobs/` + `jobStatus: unavailable_sibling`
   (schema-shape check only; **no invented results**)

## Schema

- Bundle: `x402.r2.record.recurring_job_bundle.v1`
- Request: `x402.r2.record.bundle_request.v1`
- Manifest: `x402.r2.record.job_manifest.v1`
- Bundle status: `ready` | `partial` | `rejected`
- Job status: `ready` | `partial_input` | `rejected` | `unavailable_sibling` |
  `owned_by_heavy` | `unknown`

## Quick start

See `CONSUMER.md` and `DEMO.md`.

```sh
cd experiments/scale-r2-20260910/record_jobs/08
npm test
npm run demo
node src/cli.mjs bundle
node src/cli.mjs run fixtures/positive-bundle.json
```

## CLI

| Command | Purpose |
| --- | --- |
| `bundle` | Print job manifest (05..07 ready + 01..04 heavy stubs) |
| `run <request.json\|->` | Run requested jobs against fixtures / siblings |
| `validate <request.json\|->` | Validate request shape only |
| `demo` | Offline journey → `demo-out/` |

## Mutation boundary

Exact feature-branch source only. Do not merge/publish/pay from this package.
