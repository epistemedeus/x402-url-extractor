# c34 DONE

S153 replay-pack S2 (partial-prereq). Pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Offline.

Proven: S137 `partial-mixed-operations` and `partial-external-value` stay `decision=partial` (never invented `pass`). Request-only `postCompare` keeps no 200 body; `externalValue` is not fetched or inlined. Transform and CLI (`scripts/cli.mjs analyze replay-pack`) agree. Claims stay `inventsFacts=false`, spend $0. Jobs 07/08 unused.

Files: `gates/c34/PIN.json` (case ids, paths, sha256, expected class `partial`), `helper.mjs` (schema input + CLI spawn), `gate.test.mjs` (5 pass / 0 fail), this DONE.md. Reused `src/replay-pack/{schema,transform}.mjs` and synthetic fixtures; no S137 cells rewritten.
