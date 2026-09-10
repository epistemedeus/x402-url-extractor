# c22 DONE

S153 cell `c22` (table-reconcile, S6 import-roundtrip) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Programmatic import of S137 `schema.mjs` / `transform.mjs` (not CLI) yields packet `decision=pass` for fixture `positive-agree`; JSON stringify/parse preserves `decision`, cited `findings`, `citations`, `claims`, `join`, `groups`, and `totals` (`computed/invented=false`). Catalog cases keep `fail` / `partial` / `conflict`; `conflict-value` still lists 4 vs 9 after roundtrip (no average). Jobs 07/08 unused. Offline.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md` under `experiments/s153-consumer-distribution-gates/gates/c22/`. Reused S137 `src/table-reconcile/*` and `fixtures/synthetic/table-reconcile` (did not rewrite S137 cells).

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c22/gate.test.mjs
```

7 pass, 0 fail.
