# c19 DONE

ONE real public Markdown page snapshot for R2-CONSUMER-JOBS-04 (link-to-artifact index).

Pinned `x402-foundation/x402` README at commit `3c2ddfb922893c91ef8f281b64f8045d1f5e0d75`. Live GET stored as an offline **fixture**. Relative targets not fetched. No spend.

## Files written

- `experiments/s137-consumer-evidence-jobs/fixtures/real/link-index/x402-foundation-x402-README.md`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/link-index/x402-foundation-x402-README.headers.txt`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/link-index/PROVENANCE.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/link-index/README.md`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/link-index/provenance.test.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c19/DONE.md`

## Test command

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/link-index/provenance.test.mjs
```

9 passed (offline hash + required provenance fields + positive/negative/partial/conflicting observations from the snapshot).

## evidenceClass

`fixture` (capture labeled `live-capture`, replay as fixture)

## Limitations

- One page. `./` hrefs are present but unresolved here.
- LICENSE/NOTICE/commit JSON hashes recorded; those bodies not stored.
- Retrieval `Date` is not source-update time (`commitDate` is).
- Inline-link scanner is file-bounded, not CommonMark.
- Not a legal attestation, official-ecosystem claim, or demand claim.
