# c11 DONE

Cell: `c11`  
Job: `R2-CONSUMER-JOBS-03` (source table reconciliation)  
Owned path: `src/table-reconcile/schema.mjs`  
**evidenceClass:** `synthetic`

Schema ids: `s137.table-reconcile.input.v1`, `s137.table-reconcile.output.v1`, plus fixture pins `s137.table-reconcile.case.v1` and `s137.table-reconcile.source-table.v1`.

Join contract: **keys**, **units**, **time windows**. `join.units` (measure → unit) or c13/c14 `join.unit` + `valueField`. Grain is `PnD`/`PnW` or `day`/`week`. Date-only bounds are UTC midnight; end-of-day is not inferred. `join.unit: null` is “no shared unit”, not count.

## Files written

| Path | Role |
| --- | --- |
| `src/table-reconcile/schema.mjs` | Input/output/case/source-table validators, key/unit/window primitives |
| `cells/c11/schema.test.mjs` | node:test (positive/negative/partial/conflict) |
| `cells/c11/DONE.md` | this file |

Did not write c12 transform, c13/c14 fixtures, or `test/table-reconcile.test.mjs`.

## Test command

```bash
node --test experiments/s137-consumer-evidence-jobs/cells/c11/schema.test.mjs
node experiments/s137-consumer-evidence-jobs/src/table-reconcile/schema.mjs --self-check
```

19 pass, 0 fail. Self-check ok.

## Limitations

- Does not merge rows or compare values (c12).
- Does not load pack fixtures (c13/c14) or run pack-level tests (c15).
- Does not convert units without an operator-declared `{from,to,factor}`.
- Does not invent missing rows, filled windows, grain rollups, or totals.
- Unspecified time windows make comparability partial, not global.
- No network, paid endpoints, legal attestation, or demand claims.

## Integrator notes

- Packet findings need `citationIds` resolved in `citations[]` (`path`/`url` + `contentSha256` or `sha256`).
- Output `totals.computed` / numeric `totals.value` / `guessedSum` are invalid.
- Case polarity uses `conflict` (alias `conflicting`). Finding kinds also include `agree`, `value-conflict`, `unit-conflict`, `time-window-mismatch`, `missing-in-source`, `invalid-input`.
