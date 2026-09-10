# R2-RECORD-JOBS-07 — Dependency footprint overlap

Isolated experiment under `experiments/scale-r2-20260910/record_jobs/07` in
`epistemedeus/x402-url-extractor`.

## Outcome

Show **duplicate runtime dependencies** and **declared licenses** from
**caller-supplied** lockfile / dependency inventory fixtures. Not security or
legal certification. Separate from S127 API impact analysis.

## Constraints

- Caller-supplied lockfile snapshots / normalized dependency lists only —
  **never** crawl npm or the live internet; never invent licenses or CVE scores
- Missing license fields are retained as `unknown` (no invented SPDX)
- Explicit `scopeNote` + `separateFrom: "S127"`
- No CVE score, security certification, legal advice, compliance score, invest
  advice, SEO rank, or traffic projection claims
- Synthetic fixtures only
- Feature-branch source/tests only — Root owns merge, publication, and paid actions

## Overlap fields

| Field | Meaning |
| --- | --- |
| `duplicateRuntimeDependencies[]` | Same runtime package name with multiple versions and/or across multiple supplied trees |
| `declaredLicenses[]` | License string as supplied; `unknown` when absent |
| `separateFrom` | Always `"S127"` — this package is not API impact analysis |
| `scopeNote` | Bounds the claim to supplied fixtures |

## Schema

- Input: `x402.r2.record.dependency_footprint_input.v1`
- Report: `x402.r2.record.dependency_footprint_overlap.v1`
- Status: `ready` | `partial_input` | `rejected`

## Quick start

See `CONSUMER.md` and `DEMO.md`.

```sh
cd experiments/scale-r2-20260910/record_jobs/07
npm test
npm run demo
node src/cli.mjs report fixtures/positive.json
```

## Mutation boundary

Exact feature-branch source only. Do not merge/publish/pay from this package.
