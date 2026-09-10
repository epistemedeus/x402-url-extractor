# c37 DONE (S5 cli-stdout-batch / replay-pack)

Pinned S137 tip `fa6878de125cfdcfd77f4b47037c88667090d293`. CLI `scripts/cli.mjs analyze replay-pack` emits `s137.consumer-evidence.packet.v1` JSON. Hydrated INPUT_SCHEMA from synthetic `positive-unpaid-complete` is **pass**, exit **0**, `offline:true`, `payment.attempted:false`. Catalog batch (pass/fail/fail/partial/conflict/partial) keeps those classes. Exit **2** is usage / jobs 07/08; URL `--in` is **1** and writes no JSON. `--all --in-root fixtures/synthetic` emits `s137.consumer-evidence.family.v1` with six packets; the replay-pack child is **partial** (directory is not a hydrated case). Observed vs claimed: `--in case.json` is **fail** (`f-input-invalid`, `f-no-examples`) because the wrapper is not `s137.replay-pack.input.v1` — not an invented pass. No network; `--live-capture` + synthetic is conflict and still offline.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this `DONE.md`. Reused `src/replay-pack/{schema,transform}.mjs`, `scripts/cli.mjs`, and `fixtures/synthetic/replay-pack` (not recreated). Jobs 07/08 unused.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c37/gate.test.mjs
```

Result this VM: **8 pass / 0 fail**.
