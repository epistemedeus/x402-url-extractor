# c24 DONE

ONE real official public API example snapshot for R2-CONSUMER-JOBS-05
(API example replay pack).

GitHub REST docs **Get a repository** (`GET /repos/{owner}/{repo}`) from
`https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#get-a-repository`.
Live docs GET stored as an offline **fixture**. Extracted the published
`__NEXT_DATA__` restOperation plus the visible curl in that section.
Live `api.github.com` was not called. No spend. No token.

## Files written

- `experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/github-rest-get-a-repository.operation.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/github-rest-get-a-repository.html-curl.txt`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/github-rest-get-a-repository.headers.txt`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/PROVENANCE.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/README.md`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/provenance.test.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c24/DONE.md`

## Test command

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/provenance.test.mjs
```

9 passed (offline hash pin + required provenance fields + positive/negative/partial/conflicting observations from the snapshot).

## evidenceClass

`fixture` (capture labeled `live-capture`, replay as fixture)

## Limitations

- One operation from one docs HTML GET. Full HTML (1416675 bytes) is hashed, not stored.
- HTTP Date is retrieval time, not the last edit of the REST description.
- Example JSON is the published docs example (`octocat/Hello-World`), not a live repository GET.
- 301/403/404 have no published example bodies; none were invented.
- Docs URL `apiVersion=2022-11-28` disagrees with curl `X-GitHub-Api-Version: 2026-03-10`; accept headers also disagree. Not resolved here.
- LICENSE body hashed, not stored. Not a legal attestation, customer-demand claim, or publish/merge.
