# c18 DONE

S153 gate `c18` (table-reconcile, S2 partial-prereq) on S137 pin `fa6878de125cfdcfd77f4b47037c88667090d293`.
Proven: `reconcileTables(loadCase("partial-row-coverage"))` and CLI `analyze table-reconcile` on that loaded pair emit `decision: partial`, not pass. Overlap agrees (`synthetic.page_extracts` 4 and 7); `synthetic.link_index_hits` stays `missing-in-source` for lab-b (cited to lab-a only). No fill, sum, or invented total (`inventTotals=false`, `totals.computed=false`). Case JSON without table bodies and CLI without `--in` are fail/unknown-reasons, never invented pass. Offline; payment not attempted; jobs 07/08 unused.

Files: `gates/c18/PIN.json`, `gates/c18/helper.mjs`, `gates/c18/gate.test.mjs`, `gates/c18/DONE.md`. Reused `src/table-reconcile/{schema,transform}.mjs` and synthetic `partial-row-coverage` fixtures (not recreated).

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c18/gate.test.mjs
```

Result: **8 pass, 0 fail**.
