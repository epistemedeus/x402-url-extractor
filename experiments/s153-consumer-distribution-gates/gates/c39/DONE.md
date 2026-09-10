# c39 DONE

S7 coverage-integrity for API example replay packs. Claimed PROVENANCE hashes, CC-BY-4.0 / MIT license pins, and OAS spec-unfetched notes match observed fixture bytes. Hash drift and OpenAPI-vs-companion disagreement are `conflict`, not `pass`. Transform and CLI emit `pass` for `positive-unpaid-complete` and `conflict` for `conflict-example-mismatch`; GitHub REST snapshot keeps schema/example and header disagreements unmerged. Packets stay `payment.attempted=false` with no private receipts/logs in kit. Jobs 07/08 stay excluded.

Files: `gates/c39/PIN.json`, `gates/c39/helper.mjs`, `gates/c39/gate.test.mjs`, `gates/c39/DONE.md`. Read-only reuse of `src/replay-pack/{schema,transform}.mjs`, `scripts/cli.mjs`, and synthetic/real replay-pack fixtures.

```
node --test experiments/s153-consumer-distribution-gates/gates/c39/gate.test.mjs
```

9 pass, 0 fail. Offline. Pin `fa6878de125cfdcfd77f4b47037c88667090d293`.
