# c19 DONE

S153 gate **c19** (table-reconcile, S3 conflict-identity) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Reuses S137 conflict fixtures; does not recreate c11–c14.

Proven: `reconcileTables` / `transform` and CLI `analyze table-reconcile` return **decision=conflict** for `conflict-value` (4 vs 9 kept, not averaged), `conflict-units` (count vs count_per_day is not agreement), and `conflict-time-window` (P7D vs P1D; daily rows not summed). `inventTotals` and `defaultMerge` stay false; findings are cited. Real `pair.json` catalogs a double-count merge hazard with empty `sameKeyValueDisagreements` — no invented value clash.

Jobs 07/08 remain excluded. Offline; no network/payment. Kit dir exists and is not required to contain receipts/logs for this identity check.

Files: `gates/c19/PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`.

```
node --test experiments/s153-consumer-distribution-gates/gates/c19/gate.test.mjs
```

10 pass, 0 fail.
