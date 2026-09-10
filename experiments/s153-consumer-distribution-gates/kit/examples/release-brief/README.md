# Real release fixture (c09)

One public GitHub REST snapshot for R2-CONSUMER-JOBS-02 (release evidence brief).

| Item | Value |
| --- | --- |
| Source | `https://api.github.com/repos/expressjs/express/releases/tags/v5.2.1` |
| retrievedAt | `2026-09-10T11:23:59Z` (HTTP `Date`) |
| Snapshot | `github-express-v5.2.1.json` (wire bytes, compact JSON) |
| Headers | `github-express-v5.2.1.headers.txt` |
| evidenceClass (replay) | `fixture` (captured live, used offline) |
| License note | MIT (SPDX) per GitHub license API; see `PROVENANCE.json` |

Do not treat release `body` prose as shipped or tested. Do not re-fetch in tests. Transform (c07) must keep announced / shipped / tested lanes separate and must not invent a commit SHA or CI result.

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/provenance.test.mjs
```
