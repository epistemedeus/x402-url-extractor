# Real fixture: GitHub REST "Get a repository"

Offline snapshot of one official public API example for R2-CONSUMER-JOBS-05
(API example replay pack). Replay as `fixture`. Capture was a public HTTPS GET
of docs.github.com. Live `api.github.com` was not called.

- Operation extract: `github-rest-get-a-repository.operation.json`
- Visible curl: `github-rest-get-a-repository.html-curl.txt`
- Headers: `github-rest-get-a-repository.headers.txt`
- Pin + hashes: `PROVENANCE.json`

Do not re-fetch during tests. Do not send the docs token placeholder.
No paid endpoint. Not a license grant.

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/replay-pack/provenance.test.mjs
```
