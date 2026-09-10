# c12 DONE

Cell: `c12`  
Owns: `src/table-reconcile/transform.mjs`  
Job: R2-CONSUMER-JOBS-03 (research table reconciliation)  
evidenceClass: **synthetic** (offline; uses c13 synthetic fixtures for self-check). Not live-capture. No paid demand.

## Summary

`reconcileTables` / `transform` merge supplied source tables on explicit `join.keys`, units, and time windows. Disagreement is listed per key. Totals, averages, unit conversions, grain rollups, and missing-key fills are not invented. No default merge.

Decisions pinned by c13 fixtures:

| Case | decision |
| --- | --- |
| `positive-agree` | `pass` |
| `negative-empty` | `fail` (empty rows ≠ zero) |
| `negative-missing-keys` | `fail` (raw array; keys not inferred) |
| `partial-row-coverage` | `partial` (overlap agrees; hole stays a hole) |
| `conflict-value` | `conflict` (4 vs 9 kept; not averaged) |
| `conflict-units` | `conflict` (`count` vs `count_per_day`) |
| `conflict-time-window` | `conflict` (`P7D` vs `P1D`; daily rows not summed) |

Finding `kind` uses the fixture surface labels (`agree`, `value-conflict`, `unit-conflict`, `time-window-mismatch`, `missing-in-source`, `invalid-input`); packet `caseKind` is `positive|negative|partial|conflict`. Every finding has `citationIds` into `citations[]` with path/url + sha256 when supplied.

## Files written

| Path | Role |
| --- | --- |
| `src/table-reconcile/transform.mjs` | Merge transform + `node:test` self-check |
| `cells/c12/DONE.md` | this file |

Does not write c11 schema, c13/c14 fixtures, or c15 `test/table-reconcile.test.mjs`.

## Test command

From repo root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/src/table-reconcile/transform.mjs
```

9 passed (positive, two negatives, partial, three conflicts, schema examples, manifest coverage).

Integrator:

```js
import { reconcileTables } from "./src/table-reconcile/transform.mjs";
import { loadCase } from "./fixtures/synthetic/table-reconcile/load-case.mjs";

const packet = reconcileTables(loadCase("positive-agree"));
// packet.decision, packet.findings[], packet.citations[], packet.totals.invented === false
```

Also accepts c11 `s137.table-reconcile.input.v1` documents (`join.keys` + `join.units`).

## Limitations

- Does not invent totals, averages, majority votes, or zero-fills.
- Does not convert units unless `join.conversions` declares a factor.
- Does not roll up or split time grains.
- Does not infer keys/units/windows from raw arrays.
- Does not fetch paths or URLs; table bodies must be supplied.
- Does not load pack fixtures itself (c13/c14) or replace c15 pack tests.
- Date-only / grain semantics follow supplied fields; no end-of-day inference.
- No network, paid endpoints, legal attestation, or customer-demand claims.

## evidenceClass

`synthetic`
