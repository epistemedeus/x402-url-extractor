# c14 DONE — release-brief S6 import-roundtrip

Pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Imports S137 `src/release-brief/{schema,transform}.mjs`; does not recreate those cells.

Proven: `buildReleaseBrief` + `validateReleaseBriefInput`/`validateReleaseBrief` on `positive-aligned` (sha256 `11c92a5665…827bb4`) yield `decision=pass` with announced/shipped/tested items and cited findings. `JSON.parse(JSON.stringify(brief))` and input JSON rebuild keep schema, jobId, clock, planes, citation ids, and claims. Partial (`partial-missing-tested`) and conflict (`conflict-tag-mismatch`) survive roundtrip and are not upgraded to pass. Real express v5.2.1 fixture stays `partial` with empty tested plane (no invented SHA). CLI `analyze release-brief` on the same imported input matches `pass` and wires `buildReleaseBrief`; jobs 07/08 refused.

Files: `gates/c14/PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`. Offline; payment.attempted false.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c14/gate.test.mjs
```

9 pass, 0 fail.
