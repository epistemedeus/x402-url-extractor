# c32 DONE (S8 link-index distributable archive)

S153 gate for R2-CONSUMER-JOBS-04. Pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Kit root `experiments/s153-consumer-distribution-gates/kit` has no receipts/logs; S137 `receipts/smoke/04-link-index.json` and `receipts/concurrency/admission-log.jsonl` exist outside it.

Distributable members reused from S137: synthetic `MANIFEST.json` + `README.md` + `positive-md`/`positive-html` examples, real-fixture README/PROVENANCE, skill, `src/link-index/{schema,transform}.mjs`, CLI. Jobs 07/08 remain unwired.

`transform()` on both positive examples is `decision=pass` with cited reachable findings, `networkFetched=false`, `payment.attempted=false`. CLI `analyze link-index --in <schema-input.json>` exits 0 with the same class.

`node --test experiments/s153-consumer-distribution-gates/gates/c32/gate.test.mjs`: 7 pass, 0 fail.

Wrote: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this file. Did not mutate other gates or S137 cells.
