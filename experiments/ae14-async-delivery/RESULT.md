# AE14 E08 unpaid URL jobs

Verdict: the unpaid test-only URL submit/worker/result contract is in this directory. `POST /v1/jobs` remains the terms/funding workflow and is not the extraction API. Result access for a URL job is independent of funding. Qualification of the rail stays `pending-join`. No capture, fee, or funding row is written by the URL path.

## Identity

- Base: `d5c5ab3606ba2f79d5bdfec6afb347b566966573` on `codex/ae14-e08-async-delivery` (the previous E08 export).
- Branch: `codex/ae21-e08u-unpaid-url-jobs`.
- Writer path: `experiments/ae14-async-delivery`.
- Failing-first commit: `38845c45150bf55f534414f9ef9564b27d735dfb`.
- Head: the commit that adds this file. This file cannot contain its own commit id. `git rev-parse HEAD` after that commit is the head.
- Owner: AE14 Work Network Lead `65d4d8cb-8724-40d2-a551-b88f1b6879ce` (pilot `b8ead33382b7007df337e8adf7c1536e9fb2b5c3`, `EXECUTION.md:503`).
- Pins: `PINS.json`. Monitor handback: `HANDBACK.md`.

## What the URL contract does

`POST /v1/url-jobs` accepts `{ "url" }` plus a required `Idempotency-Key`. The same tenant, key, and normalized URL return the same job. A changed body for that key is 409. The response is `unpaid: true` and `mode: "test-only"`. There is no quote.

The worker imports the repository `extract` function. It does not copy or edit that file. Concurrency is bounded. Each job has a deadline. Cancel of `working` is terminal. States are `working`, `completed`, `failed`, and `cancelled`. A missing persisted fact reads as `unknown`. Rows are in `ae14_async_url_job` in the existing PostgreSQL journal. Restart marks an already-started extraction `failed` with `restart_interrupted` and does not submit it again. A job that had not started is resumed once.

`GET /v1/url-jobs/{jobId}/result` returns the stored bytes (base64) and the sha256 of those bytes. A re-read returns the stored bytes. It does not read quote, funding, capture, or acceptance.

`GET /v1/url-jobs/{jobId}/completion` returns `{ jobId, state, digest, updatedAt }`. Identity is only `Authorization: Bearer <tenant-scoped token>`. The query string is ignored. Missing bearer is 401. Wrong tenant is 404. Both bodies use `state: "unknown"` and are never `completed`.

Completion URL for 240300: `https://{publicHost}/v1/url-jobs/{jobId}/completion` with header `Authorization: Bearer <tenant-scoped token>`. No query string. Loopback remains the default bind for disposable tests. A public origin is an explicit `https` origin whose hostname matches the bind host. A non-loopback bind without that origin is still `loopback_only`.

Outside disposable mode, a private or loopback target is refused at submit with `private_target` and is not inserted. The maintained kernel still refuses loopback itself (`ssrf_blocked`) when disposable mode hands it a loopback fixture. The positive test uses `https://fixture.example/page` and the existing fetch hook pointed at a local server. Tests do not fetch an external host.

## Tests

Failing first, commit `38845c45150bf55f534414f9ef9564b27d735dfb`:

```sh
FORCE_COLOR=0 node --test --test-concurrency=1 test/url-job-gap.test.mjs
```

Exit 1. tests 3, pass 0, fail 3. Output: `evidence/url-job-gap-failing.txt`.

Owned suite, from `experiments/ae14-async-delivery`, Node v22.22.2, local PostgreSQL 16.15:

```sh
FORCE_COLOR=0 node --test --test-concurrency=1 test/*.test.mjs
```

Exit 0. tests 35, pass 35, fail 0, skipped 0. Output: `evidence/owned-suite.log`. The original 25 funding tests are in that 35 and passed unchanged.

Inherited root suite, this worktree, Node v22.22.2, after `npm ci --ignore-scripts`:

```sh
FORCE_COLOR=0 npm test
```

Exit 1. Pretest: tests 19, pass 19. Main script: tests 1173, pass 1165, fail 3, skipped 5. Duration about 121 seconds. Output: `evidence/inherited-suite.log`.

The previously recorded inherited run was Node v22.14.0 with 6 failures. Three of those pass here because the cold acquisition pin requires Node `>=22.22.0`. The old error was `node_pin_unsatisfied v22.14.0 requires >=22.22.0`. No new failure appeared. The three that still fail are outside this writer path:

- `caller-result-client.cold.test.mjs`: installed caller consumer reaches the mounted parent without merchant source
- `caller-result-client.distribution.test.mjs`: caller generation keeps the sealed feedback archive and matches the current source
- `task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs`: two cold consumers accept the public fixture and reject the seeded controls

`public-acquisition/engine.test.mjs` rewrites `public-acquisition/loopback-profile.json` when the node pin is met. That file was restored after the run and is not in this change.

## Joins that are not done here

- 242007 `@neomorphic/journey-x402-async` at `1b5fd425408d34be232cd1c2ce059d3571b56c63` still throws `e08_extraction_submit_pending_join` from `submit()`. Proposed patch: `proposed/242007-unpaid-url-submit.patch`. pk4 HEAD `ed5fec791ef2aadf78c71acb98ff166a76bcf038` has diverged (`+99/-22` on `e08-client.mjs`). The owner rebases. This session did not edit that package.
- 240300 at `667fba353e9082d8a0842437442dabc42843abf8` still sends no `Authorization` and rejects a query string. Proposed patch: `proposed/240300-target-auth-header.patch`. Not applied.
- Rail join stays `pending-join` for A3/B3. The stand-in is not a rail. No live money, signer, wallet, publication, or deployment.

## Limits

- Market B is the only capture writer. This package writes no capture, `capture_evidence`, fee, or funding.
- No measured-economics claim. `paymentCompleted`, `acceptedSettled`, and `fundedAcceptance` stay false.
- The URL worker does not edit `extract.mjs`. Loopback targets are not fetched.
- H was not run. Anvil, the wallet keystore, and the canonical acceptance writer were not run.
