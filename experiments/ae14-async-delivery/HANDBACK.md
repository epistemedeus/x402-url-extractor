# E08 unpaid URL job handback

Writer path: `experiments/ae14-async-delivery` on `codex/ae21-e08u-unpaid-url-jobs`. Base: `codex/ae14-e08-async-delivery` @ `d5c5ab3606ba2f79d5bdfec6afb347b566966573`. This package was not merged. No file under `neomorphic-io` or under the installed 240200/240300 trees was edited. The two adapter diffs below are proposals for those owners.

Owner: AE14 Work Network Lead `65d4d8cb-8724-40d2-a551-b88f1b6879ce` (pilot `b8ead33382b7007df337e8adf7c1536e9fb2b5c3`, `overview/self-evaluations/2026-10-14-agent-economy/EXECUTION.md:503`).

## Contract that is now in this package

`POST /v1/jobs` is still the terms/funding workflow. URL extraction is `POST /v1/url-jobs`.

- Body: `{ "url": "<http or https URL>" }`. Header: `Idempotency-Key` (required). Same tenant + key + normalized URL returns the same job (201, then 200 on replay). Same key and a different URL returns 409 `idempotency_conflict`.
- Label: `unpaid: true`, `mode: "test-only"`. No quote, funding, capture, or fee.
- Worker: bounded concurrency, per-job deadline, calls the existing repository `extract` (read-only import). States: `working`, `completed`, `failed`, `cancelled`. A missing persisted fact is `unknown`.
- Cancel: `POST /v1/url-jobs/{jobId}/cancel`. Cancel of `working` is terminal. Cancel of `completed` is 409 `cancel_terminal` and the result stays.
- Deadline and a restart after `extractStarted` are terminal `failed` (`deadline`, `restart_interrupted`). Restart does not submit the extraction again.
- Result: `GET /v1/url-jobs/{jobId}/result` returns JSON `{ bytes, digest, encoding: "base64" }`. `bytes` is the stored UTF-8 payload. `digest` is the sha256 hex of those bytes. A re-read returns the stored bytes.
- Result access is independent of funding. The result route does not read quote, funding, capture, or acceptance.

Identity for every `/v1/url-jobs` route is only the `Authorization` header. The query string is not an actor.

## 240300 completion watch

Exact URL template:

`https://{publicHost}/v1/url-jobs/{jobId}/completion`

Exact header:

`Authorization: Bearer <tenant-scoped token>`

No query string. No userinfo. No explicit port (HTTPS 443). `{jobId}` matches `j` plus 32 lowercase hex characters (33 characters, under the 80-character path-segment limit, no percent-encoding).

Success body, exactly these keys:

```json
{ "jobId": "j...", "state": "working", "digest": null, "updatedAt": "..." }
```

`digest` is the sha256 hex when `state` is `completed`, otherwise `null`. `state` is one of `working`, `completed`, `failed`, `cancelled`, or `unknown`.

JSON pointers: `/jobId`, `/state`, `/digest`, `/updatedAt`.

Auth results, and they are never `state: "completed"`:

| Request | HTTP | Body state |
| --- | --- | --- |
| Bearer matches the job tenant | 200 | the persisted state |
| Missing, malformed, or unknown bearer | 401 | `unknown` |
| Bearer for a different tenant, or unknown id | 404 | `unknown` |

Loopback `127.0.0.1` remains the default bind and is only for disposable tests. `GET /v1/health` then reports `completionUrlTemplate: null`. A public watch requires `host` equal to the origin hostname and `publicOrigin` set to that `https` origin (port empty or 443, no user, query, or hash). Health then reports `completionUrlTemplate` and `completionAuthorization`. A non-loopback bind without `publicOrigin` still throws `loopback_only`.

Process env when `AE14_ASYNC_PORT=stand-in`: `AE14_ASYNC_BIND_HOST`, `AE14_ASYNC_PUBLIC_ORIGIN`, `AE14_ASYNC_URL_TOKENS` (JSON `[{ "token", "tenantId" }]`), `AE14_ASYNC_URL_CONCURRENCY`, `AE14_ASYNC_URL_DEADLINE_MS`, `AE14_ASYNC_URL_DISPOSABLE=1`, `AE14_ASYNC_URL_FIXTURE_ORIGIN`.

### Why 240300 cannot watch this URL yet

Installed monitor pin, from samedaydesk `daa3bdee79c441ba89559ea4eb2c749e312435fd` `server/lib/machine-services/PINS.json` lines 13-22:

- `services/continuous-monitoring` @ `667fba353e9082d8a0842437442dabc42843abf8`, tree `46e4be5460168417d702de864dbd3ac71bf07b29`
- `packages/change-monitor` @ `0ad6691f79225cfba782971a910c0e79d371c8f3`, tree `37048fa8f369ef1a6c0a8104a8eab8c2b7820535` (foundation, not the HTTP worker)

At `667fba35`, `policy.mjs` `targetUrl` refuses query, hash, and userinfo, requires `https` port 443 (disposable mounted `http://127.0.0.1` is the only exception), and refuses path segments over 80 characters or percent-encoding. `worker.mjs` sets only `if-none-match` / `if-modified-since`. It sends no `Authorization`. `config.mjs` `object()` rejects unknown fields, so a target credential cannot be stored today. A 304 is accepted when `Object.keys(headers).length` is truthy, so adding `Authorization` on that same object would treat a header as a validator.

Proposed patch, not applied: `proposed/240300-target-auth-header.patch`.

Apply base: neomorphic-io `667fba353e9082d8a0842437442dabc42843abf8`. Files: `services/continuous-monitoring/src/config.mjs`, `worker.mjs`, `store.mjs`. Checked with `git apply --check` against that blob and `node --check` on the patched files. Not applied to the consumer tree.

The patch adds optional `targetAuthorization` (token charset `[A-Za-z0-9_-]{8,128}`). The worker sends `Authorization: Bearer <token>`. `scopeKey` stays `digestJson({ url, mode, pointers, sourceId })` and `sourceKey` stays `digestJson({ url })`. The public monitor view deletes `targetAuthorization`. A budget revision copies the stored token through. The 304 branch keys off validator headers only. `packages/change-monitor` is not patched.

The monitors table would then hold the bearer. That is a secret at rest. The create-body idempotency digest covers the raw create input, including the token when the caller sent one. That digest is not `scopeKey` or `sourceKey`.

## 242007 adapter

Pin: neomorphic-io `codex/ae14-b2-x402async-242007` @ `1b5fd425408d34be232cd1c2ce059d3571b56c63`, package `@neomorphic/journey-x402-async`.

`packages/journey-x402-async/src/e08-client.mjs` `submit()` throws `e08_extraction_submit_pending_join` and must not call `openJob`. `RESULT.md:82` and `:84`, and `HANDOFF.md` section "E08 owner", are the request this package implemented.

Proposed patch, not applied: `proposed/242007-unpaid-url-submit.patch`.

Apply base: that pin's `packages/journey-x402-async/src/e08-client.mjs` (blob `37d3d3fddd68252fce464caa1cf25005b2b92ee7`). Checked with `git apply --check` and `node --check`. Current pk4 `HEAD` `ed5fec791ef2aadf78c71acb98ff166a76bcf038` has diverged on that file (`+99/-22`). The owner rebases before applying. This session did not edit pk4.

Behavior of the patch:

- `urlToken` unset: `submit({ url })` still throws `e08_extraction_submit_pending_join`. Funding `poll` and `result` (the `POST /v1/jobs/:id/reuse` readback) stay as they are.
- `urlToken` set: `submit({ url, idempotencyKey })` posts `{ url }` to `/v1/url-jobs` with `Authorization: Bearer` and `Idempotency-Key`. It does not call `openJob`.
- `poll` tries `GET /v1/url-jobs/{jobId}` and falls back to the funding query route only on HTTP 404. A non-404 URL-job response is not retried as a funding job.
- `result` tries `GET /v1/url-jobs/{jobId}/result`. HTTP 409 `result_not_ready` stays on the URL job and does not call `reuse`. HTTP 404 falls back to the funding reuse readback. The bytes are checked with sha256 before projection.
- Job ids share the `j` + 32 hex shape, so the adapter does not distinguish the two workflows by id shape.

Until that patch is reviewed and a deployment passes `urlToken`, the gateway `e08.async.submit` gap remains.

## Extraction kernel boundary

The worker imports `extract` from the repository root `extract.mjs` at the base commit (blob `2f27b32abc2bdbccf47fbab869421b2ad01da1a6`). That function calls `assertPublicHttpUrl` before fetch. This package does not edit it.

Outside disposable mode, a private, loopback, localhost, or link-local target is refused at submit with 400 `private_target` and is not inserted. Disposable mode can name a `fixtureOrigin`. A loopback URL that matches it is handed to `extract`, which still fails closed with `ssrf_blocked` and does not fetch. The positive test uses a public-looking URL (`https://fixture.example/page`) and the existing `globalThis.__SAMEDAYDESK_EXTRACT_FETCH__` hook pointed at a local fixture server. No test fetches an external host.

## Money

Market B remains the only capture writer. This package writes no capture, no `capture_evidence`, no fee, and no funding on the URL path. Kernel migration 005 `captured` is not written here. The URL journal table is `ae14_async_url_job` in the existing PostgreSQL journal. The funding tables and the stand-in invocation count are unchanged by a URL job. Rail qualification stays `pending-join` (A3/B3). The stand-in is not a rail. No live money, signer, wallet, publication, or deployment.
