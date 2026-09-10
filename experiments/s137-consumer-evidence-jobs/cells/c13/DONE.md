# c13 DONE

Cell: `c13`  
Owns: `fixtures/synthetic/table-reconcile/`  
Job: R2-CONSUMER-JOBS-03 (research table reconciliation)  
**evidenceClass:** `synthetic`

## Summary

Authored synthetic source-table pairs for merge-by-keys/units/time-windows. Cases pin expected packet `decision` and cited findings only; they do not invent totals, unit conversions, or grain rollups. `load-case.mjs` `toSchemaInput()` maps onto c11 `s137.table-reconcile.input.v1`.

## Files written

| Path | Role |
| --- | --- |
| `fixtures/synthetic/table-reconcile/CLOCK.txt` | Operator clock `2026-09-10T12:00:00.000Z` |
| `fixtures/synthetic/table-reconcile/MANIFEST.json` | Catalog of seven cases / four kinds |
| `fixtures/synthetic/table-reconcile/README.md` | Table format and decision pins |
| `fixtures/synthetic/table-reconcile/PROVENANCE.json` | sha256 + license note |
| `fixtures/synthetic/table-reconcile/hash.mjs` | sha256 helper |
| `fixtures/synthetic/table-reconcile/load-case.mjs` | Case loader + c11 input mapper |
| `fixtures/synthetic/table-reconcile/catalog.test.mjs` | node:test catalog integrity |
| `fixtures/synthetic/table-reconcile/cases/positive-agree.json` | positive / pass |
| `fixtures/synthetic/table-reconcile/cases/negative-empty.json` | negative / fail (empty rows) |
| `fixtures/synthetic/table-reconcile/cases/negative-missing-keys.json` | negative / fail (raw array) |
| `fixtures/synthetic/table-reconcile/cases/partial-row-coverage.json` | partial (missing key in lab-b) |
| `fixtures/synthetic/table-reconcile/cases/conflict-value.json` | conflict (4 vs 9) |
| `fixtures/synthetic/table-reconcile/cases/conflict-units.json` | conflict (count vs count_per_day) |
| `fixtures/synthetic/table-reconcile/cases/conflict-time-window.json` | conflict (P7D vs P1D; do not sum) |
| `fixtures/synthetic/table-reconcile/sources/*/` | lab-a / lab-b tables |
| `cells/c13/DONE.md` | this file |

28 files under owned path plus this DONE.md (29).

## Test command

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile/catalog.test.mjs
```

Result: **12 pass, 0 fail**.

## Limitations

- Synthetic only. Not a live public table pair (c14).
- Does not implement table-reconcile transform (c12) or pack tests (c15).
- c11 `classifyJoin` is structural: value disagreement and grain mismatch stay c12; empty rows validate as input and classify `partial`, while this catalog pins packet `fail` (no zero-fill).
- `count_per_day` is an unknown unit id (not in c11 catalog); unknown units are not assumed compatible and no conversion is supplied.
- Does not copy payment code or execute paid endpoints.
- Expected findings are catalog pins for c12/c15; this cell does not emit packets.

## evidenceClass

`synthetic`
