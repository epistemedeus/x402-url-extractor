# c30 DONE

S6 import-roundtrip for `link-index` (R2-CONSUMER-JOBS-04) at pin `fa6878de125cfdcfd77f4b47037c88667090d293`.
Programmatic import of `src/link-index/{schema,transform}.mjs` indexes pinned synthetic `positive-html` to `decision=pass` (`s137.link-index.output.v1`). JSON stringify/parse keeps schema, jobId, clock, links/anchors/targets, cited findings, coverage (`networkFetched=false`), and claims; `validateOutput` accepts the clone.
`positive-md` also passes; `negative-empty` stays `fail` with no invented hrefs; `partial-mixed` stays `partial`; `conflict-duplicates` stays `conflict` (duplicates + conflicts kept, no silent merge). Offline; jobs 07/08 unused.
Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`.
`node --test experiments/s153-consumer-distribution-gates/gates/c30/gate.test.mjs` → **5 pass, 0 fail**.
