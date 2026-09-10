# c26 DONE

S153 S2 (partial-prereq) for R2-CONSUMER-JOBS-04 link-index. Reused S137 `partial-mixed` plus schema example partial. Transform and CLI both emit `decision: partial`; pass is not invented when a reachable present file is mixed with missing file, missing fragment, unfetched `https://example.invalid/never-fetched`, and `../outside.md` escape. `artifacts/missing.md` stays absent. `coverage.networkFetched` is false; findings keep citationIds; jobs 07/08 unused.

`node --test experiments/s153-consumer-distribution-gates/gates/c26/gate.test.mjs` — 5 pass, 0 fail.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`. Read-only: `src/link-index/{schema,transform}.mjs`, `scripts/cli.mjs`, `fixtures/synthetic/link-index/cases/partial-mixed/`.
