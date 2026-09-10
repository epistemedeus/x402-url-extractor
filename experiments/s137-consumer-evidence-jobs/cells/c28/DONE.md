# c28 DONE

Cell: `c28`  
Owns: `fixtures/synthetic/freshness/`  
Job: R2-CONSUMER-JOBS-06 (dataset freshness receipt)  
**evidenceClass:** `synthetic`

## Summary

Synthetic freshness inputs that keep download time (`retrievedAt` / `captured_at` / `capturedAtUtc`) separate from source-update time (`published_at` / `lastUpdated`). Timestamps are copied from S122 fixture fields and one in-repo future-date control; none are invented. Cases pin expected `decision` and cited findings for c27/c30. Each case validates with c26 `validateInput`.

## Files written

| Path | Role |
| --- | --- |
| `fixtures/synthetic/freshness/CLOCK.txt` | Operator clock `2026-09-10T09:54:59Z` (S122 `CAPTURED_AT_UTC.txt` bytes) |
| `fixtures/synthetic/freshness/MANIFEST.json` | Catalog of six cases |
| `fixtures/synthetic/freshness/README.md` | Time-field contract and case map |
| `fixtures/synthetic/freshness/catalog.mjs` | Loader, ages, provenance writer |
| `fixtures/synthetic/freshness/freshness.fixtures.test.mjs` | node:test integrity + c26 validateInput |
| `fixtures/synthetic/freshness/PROVENANCE.json` | sha256 per file; `liveCapture: false` |
| `fixtures/synthetic/freshness/sources/*.json` | Slim field-preserving extracts |
| `fixtures/synthetic/freshness/cases/positive-complete.json` | positive / pass |
| `fixtures/synthetic/freshness/cases/negative-missing-times.json` | negative / unknown |
| `fixtures/synthetic/freshness/cases/negative-future-source-update.json` | negative / unknown (future lastUpdated) |
| `fixtures/synthetic/freshness/cases/partial-missing-source-update.json` | partial (no published_at; EOL 3/26) |
| `fixtures/synthetic/freshness/cases/conflict-retrieved-before-source.json` | conflict (capture before published_at) |
| `fixtures/synthetic/freshness/cases/conflict-two-source-updates.json` | conflict (two published_at values) |
| `cells/c28/DONE.md` | this file |

19 files under owned path plus this DONE.md (20).

## Test command

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/freshness/freshness.fixtures.test.mjs
```

Result: **12 pass, 0 fail**. Offline. No network.

## Limitations

- Synthetic only. Not a live public-dataset snapshot (c29).
- Does not implement freshness-receipt schema or transform (c26/c27).
- Clock is not substituted for missing `retrievedAt` or `sourceUpdatedAt`.
- Future source-update instants yield unknown age (`null`), not a current claim.
- Expected findings are catalog pins for c30; this cell does not emit receipts.
- No paid endpoints, no legal attestation, no customer-demand claims.

## evidenceClass

`synthetic`
