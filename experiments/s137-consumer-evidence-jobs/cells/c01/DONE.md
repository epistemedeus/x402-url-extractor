# c01 DONE

Cell: `c01`  
Job: `R2-CONSUMER-JOBS-01` documentation migration checklist schema  
Schema: `s137.migration-checklist.input.v1` / `s137.migration-checklist.output.v1`  
**evidenceClass:** synthetic

## Files written

| Path | Role |
| --- | --- |
| `src/migration-checklist/schema.mjs` | Input/output shapes, cited field catalog, validators |
| `cells/c01/schema.test.mjs` | node:test positive/negative/partial/conflict |
| `cells/c01/DONE.md` | this file |

Did not write `src/migration-checklist/transform.mjs` (c02), `fixtures/synthetic/migration/` (c03), `fixtures/real/migration/` + PROVENANCE (c04), or `test/migration-checklist.test.mjs` (c05). Jobs 07/08 untouched.

## Test command

From repo root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/cells/c01/schema.test.mjs
node experiments/s137-consumer-evidence-jobs/src/migration-checklist/schema.mjs --self-check
```

Result: **17 pass, 0 fail**; self-check `{"ok":true,"failures":0}`.

## Contract (for c02)

- Input is supplied old docs, new docs, and caller operation inventory (`method` + `route` / `path`, optional `operationId`).
- Operator `clock` is required ISO-8601; `"now"` is refused.
- `evidenceClass` is `synthetic | fixture | live-capture`.
- Findings and checklist rows need `citationIds` into `citations[]` (path and/or url; sha256 when possible).
- Same path with old vs new hashes is a migration, not a citation conflict. Unexplained hash disagreement is `conflict`.
- `decision: pass` is incompatible with missing/partial/conflict coverage.
- Output stays `offline: true`, `payment.attempted: false`, `cost.assignmentSpendUsd: 0`.
- Every catalog field has `citationIds` into `CITATIONS` (pack files hashed; S122/S127 reused read-only).

## Limitations

- Schema validation only; does not parse documentation bodies (c02).
- Omitted STATE inventory is not invented (`missing_source` / partial).
- Complete coverage here means required collections are present, not that every operation has a parsed doc hit.
- No network, no paid endpoint, no legal attestation, no customer-demand claim.
- Real public docs + `PROVENANCE.json` belong to c04.

## evidenceClass

`synthetic`
