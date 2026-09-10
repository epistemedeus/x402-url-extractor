# c38 DONE

Cell `c38`, artifact `replay-pack`, S6 import-roundtrip. Pin `fa6878de125cfdcfd77f4b47037c88667090d293`.
Proven: import of S137 `src/replay-pack/{schema,transform}.mjs` on synthetic `positive-unpaid-complete` yields `decision: pass` (`s137.replay-pack.output.v1`), `offline: true`, `payment.attempted: false`, spend 0.
JSON.stringify/parse preserves required packet fields and re-validates `ok`; the packet is invalid as input (`schema.const`). Transform aliases are one function. Catalog `case.json` findings are not copied (`packet.findings` stays `[]`). Jobs 07/08 unused; CLI is S5.
Files: `gates/c38/PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`. Reused S137 fixtures; did not recreate S137 cells.
`node --test experiments/s153-consumer-distribution-gates/gates/c38/gate.test.mjs` → **3 pass, 0 fail**.
