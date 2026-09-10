# c14 DONE

Cell: `c14`  
Job: `R2-CONSUMER-JOBS-03` (source table reconciliation)  
Owned path: `fixtures/real/table-reconcile/`  
**evidenceClass:** `fixture` (replay of `live-capture`; not synthetic)

One real public table pair: npm daily download counts for `express`, two overlapping UTC windows, stored offline.

| Table | Window (inclusive) | Rows |
| --- | --- | --- |
| A | 2026-08-01 .. 2026-08-14 | 14 |
| B | 2026-08-08 .. 2026-08-21 | 14 |

Join keys: `(package, day)`. Unit: `count` (npm download events / UTC day). Grain: `day`.

Observed from the captured bytes (not invented):

- **positive:** 7 overlapping days, identical counts
- **negative:** 7 days only in A (08-01..07); 7 days only in B (08-15..21)
- **partial:** union 21 days; neither slice covers it
- **conflict:** no same-key value disagreement; concatenating without window align would double-count the 7-day intersection. 2026-08-14 is `0` in both slices; retained

No union total is emitted.

## Files written

- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/PROVENANCE.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/pair.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/provenance.test.mjs`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/sources/npm-downloads-range-a.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/sources/npm-downloads-range-a.headers.txt`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/sources/npm-downloads-range-b.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/sources/npm-downloads-range-b.headers.txt`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/sources/npm-download-counts.md`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/tables/express-downloads-2026-08-01-2026-08-14.csv`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/tables/express-downloads-2026-08-08-2026-08-21.csv`
- `experiments/s137-consumer-evidence-jobs/cells/c14/DONE.md` (this file)

## Test command

From repo root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/table-reconcile/provenance.test.mjs
```

8 passed (offline). No `npm install`.

## Limitations

- Capture clock `2026-09-10T11:22:45.000Z`. Counts can change if re-fetched; replay uses stored bytes.
- CSV is a deterministic projection of the JSON, not a second measurement.
- GitHub traffic snapshots were not used (authenticated, not public).
- npm/registry docs repo reports `license: null`. License note is not a grant or legal attestation.
- No paid endpoint, no spend, no customer demand claim, no default merge.

Set-Cookie from the live responses was stripped from stored headers.
