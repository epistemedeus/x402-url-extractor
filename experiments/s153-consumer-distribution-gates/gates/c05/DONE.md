# c05 DONE (S5 cli-stdout-batch / migration-checklist)

Pinned S137 tip `fa6878de125cfdcfd77f4b47037c88667090d293`. CLI `scripts/cli.mjs analyze migration-checklist --in <case>` emits `s137.consumer-evidence.packet.v1` JSON on stdout; primary `positive-complete` is **pass** with cited extract/read unchanged and batch-added-unused. Exit **0** whenever a packet is emitted (including fail/partial/conflict); usage is **2**; URL `--in` is **1** and writes no JSON. `--all` emits `s137.consumer-evidence.family.v1` with six packets; the migration packet stays pass on the primary fixture while the family decision is fail because sibling jobs reject that input. Offline: `offline:true`, `payment.attempted:false`, no network I/O; jobs 07/08 refused. Observed: fixture wrappers produce `cli.schema-rejected` but transformFixtureCase still supplies the cited decision.

Files: `gates/c05/PIN.json`, `gates/c05/helper.mjs`, `gates/c05/gate.test.mjs`, `gates/c05/DONE.md`. Reused S137 fixtures/src/cli; no other `gates/cXX` mutated.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c05/gate.test.mjs
```

Result this VM: 7 pass / 0 fail.
