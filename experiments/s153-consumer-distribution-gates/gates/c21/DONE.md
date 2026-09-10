# c21 DONE

S5 CLI gate for `table-reconcile` (R2-CONSUMER-JOBS-03) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Single `analyze table-reconcile` of `toSchemaInput(positive-agree)` exits 0, prints `s137.consumer-evidence.packet.v1`, decision `pass`, cited agree findings, `offline:true`, spend $0. Batch of the four pinned cases is pass/fail/partial/conflict, each still exit 0. `analyze --all` emits `family.v1` with six packets including table-reconcile and stays offline.

CLI does not fetch: case JSON path refs without bodies are `fail`/`missing-body`; `https://` `--in` is exit 1; jobs 07/08 are usage exit 2; `--live-capture` still performs no network I/O. Fixture directory as `--in` is observed `fail`, not an invented pass.

Files: `gates/c21/PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`. Reused S137 `scripts/cli.mjs`, `src/table-reconcile/{schema,transform}.mjs`, synthetic fixtures. Did not recreate S137 cells or touch other `gates/cXX`.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c21/gate.test.mjs
```

Result this VM: **8 pass, 0 fail**. evidenceClass: `synthetic`.
