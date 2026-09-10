# c45 DONE

S5 CLI stdout/batch for freshness-receipt (R2-CONSUMER-JOBS-06) on pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Offline; jobs 07/08 refused.

`analyze freshness-receipt --in positive-complete.json` exits 0 and prints `s137.consumer-evidence.packet.v1` with `decision=pass`, cited `times_distinct` findings, `offline=true`, `payment.attempted=false`. Download time is not source-update. The six synthetic cases batch to pass/partial/unknown/unknown/conflict/conflict (exit 0). `analyze --all` emits family.v1 with six packets (freshness child fail/`transform_threw` on the fixture directory). Remote `--in` exits 1; missing `--clock` and jobs 07/08 exit 2.

Wrote `gates/c45/{PIN.json,helper.mjs,gate.test.mjs,DONE.md}`. Reused `scripts/cli.mjs`, `src/freshness-receipt/{schema,transform}.mjs`, and synthetic/real freshness fixtures. Did not recreate S137 cells.

`node --test experiments/s153-consumer-distribution-gates/gates/c45/gate.test.mjs` — 9 pass / 0 fail. No network.
