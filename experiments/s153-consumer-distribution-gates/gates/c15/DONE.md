# c15 DONE

S7 coverage-integrity for release-brief (R2-CONSUMER-JOBS-02). Integrity decision class is **pass** when PROVENANCE/hash/license pins match observed bytes.

Announced identities stay claimed; shipped/tested stay observed. `positive-aligned` is pass. `conflict-sha-mismatch` keeps both SHAs and decides conflict. `conflict-ci-vs-announce` keeps the announced “All tests passed” claim against observed CI failure. Real express v5.2.1 is partial: MIT pin + snapshot hash hold; `master`/`tarball_url` are not a ship. Packets do not cite private `receipts/` logs. Jobs 07/08 out of scope.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`.

`node --test experiments/s153-consumer-distribution-gates/gates/c15/gate.test.mjs` — 13 passed, offline.
