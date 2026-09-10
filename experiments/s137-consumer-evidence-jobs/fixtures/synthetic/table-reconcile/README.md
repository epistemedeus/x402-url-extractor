# Synthetic table-reconcile fixtures

Label: **`synthetic`**. Authored for R2-CONSUMER-JOBS-03 (research table reconciliation). Not live-capture, not a registry or traffic extract, not paid demand.

Clock: `2026-09-10T12:00:00.000Z` (`CLOCK.txt`).

Job contract these files pin: merge supplied tables using explicit **keys / units / time windows**, and **surface disagreement** rather than inventing totals, unit conversions, or grain rollups.

## Cases

| Id | Kind | Expected `decision` | What is pinned |
| --- | --- | --- | --- |
| `positive-agree` | positive | `pass` | Same keys, `count`, `P7D` windows; values match (row order differs) |
| `negative-empty` | negative | `fail` | lab-a `rows: []`; absence is not zero-fill |
| `negative-missing-keys` | negative | `fail` | lab-a is a bare array; keys/unit/window cannot be inferred |
| `partial-row-coverage` | partial | `partial` | Overlap agrees; `synthetic.link_index_hits` missing from lab-b |
| `conflict-value` | conflict | `conflict` | `4` vs `9` on the same key; keep both values |
| `conflict-units` | conflict | `conflict` | `count` vs `count_per_day`; numeric 4 is not agreement |
| `conflict-time-window` | conflict | `conflict` | `P7D` vs `P1D` over the same span; do not sum daily rows |

## Layout

- `sources/<id>/lab-a.json`, `lab-b.json` — source tables
- `cases/<id>.json` — join spec, expected findings with `citationIds`, `citations[]` with sha256
- `MANIFEST.json` — required kinds and case list
- `PROVENANCE.json` — sha256 + license note per file
- `hash.mjs`, `load-case.mjs` — Node builtins only
- `catalog.test.mjs` — fixture integrity (not the c12 transform)

Source-table fields (wrapped tables): `schema`, `id`, `evidenceClass`, `keys`, `unit`, `timeWindow`, `columns`, `rows`.

`timeWindow.end` is exclusive (`inclusiveEnd: false`). Grain is ISO-8601 duration (`P7D`, `P1D`) on the source table; c11 schema does not classify grain (c12 must).

Case `join.units` is `{ "value": "<unit>" }` for c11 `s137.table-reconcile.input.v1`. `load-case.mjs` `toSchemaInput()` maps catalog cases onto that shape. Column roles are `key|measure|time` (no invented `bound` role).

## Decision pins for c12 / c15

1. Matching keys+unit+grain+value ⇒ `agree` / packet `pass`.
2. Empty or missing keys ⇒ `invalid-input` / packet `fail`. Do not infer.
3. Proper-subset coverage with agreeing overlap ⇒ `partial`. Do not fill missing keys.
4. Same key/unit/window, different value ⇒ `value-conflict`. Do not average.
5. Same key/window, different unit, no conversion table ⇒ `unit-conflict`.
6. Overlapping span, different grain ⇒ `time-window-mismatch`. Do not roll up.

Transform tests live in `test/table-reconcile.test.mjs` (cell c15). Real public tables live in `fixtures/real/table-reconcile/` (cell c14).
