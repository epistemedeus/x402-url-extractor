# c10 DONE

S2 partial-prereq for R2-CONSUMER-JOBS-02 release-brief. Reused S137 synthetic partial fixtures (`partial-missing-tested`, `partial-announced-only`, `partial-shipped-no-announce`) plus the real express v5.2.1 GitHub snapshot. `buildReleaseBrief` returns **partial**, not pass; missing announced/shipped/tested planes stay empty (no invented CI, tag, or notes). Schema rejects promoting a two-plane brief to pass (`decision_mismatch`). CLI `analyze release-brief` on the same case JSON is partial/unknown, offline, unpaid.

Files: `gates/c10/PIN.json`, `gates/c10/helper.mjs`, `gates/c10/gate.test.mjs`, `gates/c10/DONE.md`. Imports S137 `src/release-brief/{schema,transform}.mjs` and `scripts/cli.mjs`. Did not recreate S137 cells or touch other `gates/cXX`.

```bash
node --test experiments/s153-consumer-distribution-gates/gates/c10/gate.test.mjs
```

Result: **5 pass, 0 fail**. Pin `fa6878de125cfdcfd77f4b47037c88667090d293`. Jobs 07/08 out of scope.
