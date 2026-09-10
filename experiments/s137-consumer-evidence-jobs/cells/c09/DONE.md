# c09 DONE

ONE real public GitHub release JSON snapshot for R2-CONSUMER-JOBS-02 (release evidence brief).

Pinned `expressjs/express` tag `v5.2.1` via GitHub REST
`/repos/expressjs/express/releases/tags/v5.2.1`. Live GET stored as an offline
**fixture**. Wire bytes kept compact (no pretty-print). No spend. No GitHub token.

## Files written

- `experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/github-express-v5.2.1.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/github-express-v5.2.1.headers.txt`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/PROVENANCE.json`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/README.md`
- `experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/provenance.test.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c09/DONE.md`

## Test command

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/provenance.test.mjs
```

8 passed (offline hash pin + required provenance fields + positive/negative/partial/conflicting observations from the snapshot).

## evidenceClass

`fixture` (capture labeled `live-capture`, replay as fixture)

## Limitations

- `assets[]` is empty; that does not prove binaries do not exist elsewhere (npm is not in this JSON).
- `target_commitish` is `master`, not a git SHA; shipped commit is unidentified here.
- No CI/test fields; tested lane is absent, not failed.
- Release `body` is announced prose (mentions v5.2.0 and rejected CVE-2024-51999); not independently verified.
- `created_at`, `published_at`, and `updated_at` differ; do not collapse them.
- License API body hashed at retrieve time and not retained.
- Not a legal attestation, customer-demand claim, or publish/merge.
