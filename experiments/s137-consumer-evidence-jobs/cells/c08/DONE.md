# c08 DONE

Synthetic pos/neg/partial/conflict release-brief fixtures for R2-CONSUMER-JOBS-02.

Announced, shipped, and tested stay in separate lane files. Catalog does not merge disagreeing tags, SHAs, or CI conclusions. Not a live GitHub/npm capture. No spend.

## Files written

- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/CLOCK.txt`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/MANIFEST.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/README.md`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/SOURCE-PINS.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/PROVENANCE.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/hash.mjs`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/load.mjs`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/write-cases.mjs`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/catalog.test.mjs`
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/cases/*.json` (9 cases)
- `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/sources/**/*.json` (19 lane/notice documents)
- `experiments/s137-consumer-evidence-jobs/cells/c08/DONE.md`

## Test command

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/catalog.test.mjs
```

13 passed (offline catalog integrity; citation sha256; pos/neg/partial/conflict observations).

## evidenceClass

`synthetic`

## Limitations

- Lab subject `demo-release-kit`; commit SHAs are sha1 of lab strings, not this repo's git objects.
- Does not run c07 transform or c06 schema tests (those cells own those paths).
- Case `input` matches `s137.release-brief.input.v1` source/plane/kind shapes; not a produced brief.
- No real GitHub release snapshot (c09). No paid endpoint, legal attestation, or demand claim.
