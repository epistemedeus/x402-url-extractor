# Inventory

The test `test/outcome.test.mjs` checks that every path below exists and is non-empty, and that every fixture hash in `fixtures/manifest.json` matches the bytes on disk. Clean git status is not this inventory.

- README.md
- RESEARCH.md
- RESULT.md
- NEXT.md
- INVENTORY.md
- src/osv-pin.mjs
- src/reader-claim.mjs
- src/batch-envelope.mjs
- src/maintain.mjs
- src/scenarios.mjs
- src/recommendation.mjs
- src/required-files.mjs
- bin/run-outcome.mjs
- test/outcome.test.mjs
- fixtures/manifest.json
- fixtures/osv-query-axios-1.19.0.json
- fixtures/osv-query-axios-1.20.0.json
- fixtures/github-advisory-GHSA-3pq3-5fj3-cg6v.html
- fixtures/laboratory/false-clear.html
- fixtures/laboratory/error-page-says-clear.html

Primary captures are the two OSV query bodies and the GitHub advisory HTML. `fixtures/laboratory/` is authored for contradiction and source failure. It is not a capture.
