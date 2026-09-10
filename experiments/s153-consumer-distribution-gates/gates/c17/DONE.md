# c17 DONE

S1 positive-workflow on `table-reconcile` (R2-CONSUMER-JOBS-03). Pinned synthetic case `positive-agree` plus lab-a/lab-b hashes match S137 fixtures. `reconcileTables(loadCase("positive-agree"))` emits `decision=pass`, `caseKind=positive`, `inventTotals=false`, and three cited `agree` findings (`synthetic.page_extracts` 4 and 7, `synthetic.link_index_hits` 2) with citation ids `src:positive-agree/lab-*`. CLI `analyze table-reconcile` on `toSchemaInput` of that case exits 0 with `pass` and the same finding ids (citation ids `src:lab-a` / `src:lab-b` because schema input uses table ids). Offline, `payment.attempted=false`, no demand claims, no invented union total. Jobs 07/08 unused. Raw `cases/positive-agree.json` is not a complete CLI body (paths without rows).

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this `DONE.md`. Reused `src/table-reconcile/{schema,transform}.mjs` and `fixtures/synthetic/table-reconcile` (not recreated).

```
node --test experiments/s153-consumer-distribution-gates/gates/c17/gate.test.mjs
```

Result: **3 pass, 0 fail**.
