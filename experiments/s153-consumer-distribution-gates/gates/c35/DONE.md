# c35 DONE

Gate S3 (conflict-identity) for `replay-pack` on pin `fa6878de125cfdcfd77f4b47037c88667090d293`.
Proven: synthetic `conflict-example-mismatch` still disagrees (`openapi-example` `ok:true` vs companion `ok:false`). `validateReplayPackInput` reports `examples.conflict`. `transform` keeps `decision=conflict`, both `getStatus-enabled` bodies, and does not equalize `ok` or pick a winner.
CLI `analyze replay-pack --in <schema-input>` exits 0 with `decision=conflict` (not pass). Claims/payment stay false. Jobs 07/08 unwired.
Reused S137 fixtures + `src/replay-pack/{schema,transform}.mjs` + `scripts/cli.mjs`. Did not recreate S137 cells.
Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`.
Test: `node --test experiments/s153-consumer-distribution-gates/gates/c35/gate.test.mjs` → 5 pass.
