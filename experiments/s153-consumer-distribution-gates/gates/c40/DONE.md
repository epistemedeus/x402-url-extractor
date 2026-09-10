# c40 DONE

S8 kit-membership gate for R2-CONSUMER-JOBS-05 (`replay-pack`) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`.

Proven: `transform(schemaInputFromPositive())` and CLI `analyze replay-pack --in` of that same schema input both emit `decision=pass`, `offline:true`, `payment.attempted:false`, no invented demand, no provider execution. Fixture sha256s match PIN (observed-vs-claimed). S137 source pack supplies `MANIFEST.json`, `README.md`, and `cases/positive-unpaid-complete/examples/`; `receipts/smoke/05-replay-pack.json` and concurrency `.jsonl` classify as non-distributable. Packed `experiments/s153-consumer-distribution-gates/kit` contains no receipts/logs. Jobs 07/08 remain refused by CLI `list`/`analyze`.

Files: `gates/c40/PIN.json`, `gates/c40/helper.mjs`, `gates/c40/gate.test.mjs`, `gates/c40/DONE.md`. Reused S137 `src/replay-pack/{schema,transform}.mjs`, `scripts/cli.mjs`, and `fixtures/{synthetic,real}/replay-pack`. Did not recreate S137 cells or write other `gates/cXX`.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c40/gate.test.mjs
```

Result this VM: 6 pass / 0 fail.
