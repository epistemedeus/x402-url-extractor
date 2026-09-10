# c20 DONE

S4 malformed-input for `table-reconcile` (R2-CONSUMER-JOBS-03) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Reused S137 synthetic negatives; did not recreate S137 cells.

**Proven:** `reconcileTables(loadCase("negative-empty"))` and `negative-missing-keys` return `decision=fail` / `caseKind=negative` with cited `invalid-input` findings (`empty-rows`, `missing-keys`). Empty rows are not zero-filled; a bare array is not a keyed table. Path-only case JSON fails `missing-body` (no fetch). Schema `validateInput(null|[])` and `validateSourceTable(array)` reject. CLI `analyze table-reconcile` on the case JSON is `decision=fail` with stable exit 0; URL `--in` exits 1; missing/oversize `--in` exit 1 with `ok=false` fail packets. Repeat runs keep the same exit. Jobs 07/08 remain refused. No invented totals or demand.

**Files:** `gates/c20/PIN.json`, `gates/c20/helper.mjs`, `gates/c20/gate.test.mjs`, `gates/c20/DONE.md`.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c20/gate.test.mjs
```

12 pass, 0 fail. evidenceClass: `synthetic`.
