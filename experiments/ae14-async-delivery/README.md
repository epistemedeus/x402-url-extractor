# AE14 async delivery

Acceptance-sensitive async service for SameDayDesk-style work. It is a second consumer of the funding and receipt port. The live immediate-pay routes and the paid `/read` wrapper in this repository are not part of this package and are not modified.

The rail interface was checked against pilot `tools/agent-economy-rail` at A amend `f89939a09feaf6b710d04abf8109c4a0b790f05c`. The real rail is not attached. Join stays `pending-join` for A3/B3. The stand-in speaks `readback`, `capture`, `readProof`, and `stage` with `provenance: fake`. An unjournaled operator capture and a clock expiry that is not a mined reclaim read back as `unknown` and do not capture. A mined reclaim is the expiry winner. Disposable quotes use symbol `USDC` on `eip155:31337` and refuse the production USDC address.

Fee on a new quote is `floor(gross * 500 / 10000)` for one capture. Rail cost stays separate. Terms `221400` and `234100` are refused unchanged: no 5% fee and no new wallet. If the escrow is already reclaimed, accept records expiry, does not capture, and does not grant reuse. A later expiry does not replace a captured outcome. A lost capture response is resolved by readback and is not posted again.

```sh
npm ci --ignore-scripts
npm test
```

`POST /v1/jobs` stays the terms and funding workflow. It does not submit a URL for extraction.

Unpaid URL extraction is a separate test-only contract. `POST /v1/url-jobs` takes `{ "url" }` and a required `Idempotency-Key` header. The same tenant, key, and normalized URL return the same job. The same key with a different URL returns 409. The response is labelled `unpaid: true` and `mode: "test-only"`. This route does not quote, fund, capture, or charge a fee.

Result access is independent of funding. `GET /v1/url-jobs/{jobId}/result` returns the stored extraction bytes and their sha256 digest. It does not read a quote, a funding proof, a capture, or an acceptance. A job that was never funded still returns its stored result after the worker completes, and a re-read returns those same bytes.

The worker calls the repository's existing `extract` implementation. It does not copy that file. Concurrency is bounded (1..8). Each job has a deadline. `POST /v1/url-jobs/{jobId}/cancel` is terminal. States are `working`, `completed`, `failed`, and `cancelled`. A missing persisted state reads as `unknown`. Rows are in the existing PostgreSQL journal (`ae14_async_url_job`). After a restart, work whose extraction had already started is marked `failed` with reason `restart_interrupted` and is not submitted again. Work that had not started is resumed once.

Identity on these routes is only `Authorization: Bearer <tenant-scoped token>`. Query parameters are ignored. A missing or unknown bearer is 401. A bearer for another tenant is 404. Those refusals use `state: "unknown"` and are never `completed`.

`GET /v1/url-jobs/{jobId}/completion` returns `{ "jobId", "state", "digest", "updatedAt" }`. The monitor URL is `https://{publicHost}/v1/url-jobs/{jobId}/completion` with header `Authorization: Bearer <tenant-scoped token>` and no query string. `HANDBACK.md` records that template for 240300.

The default listen address remains `127.0.0.1` for disposable tests. A public origin is explicit: bind `host` to that origin's hostname and set `publicOrigin` to its `https` origin on port 443. A non-loopback bind without `publicOrigin` is still refused with `loopback_only`. `AE14_ASYNC_PORT=stand-in` is the labelled disposable process mode. Any other port mode exits pending-join. This package does not run the selected chain, writes no capture, and does not claim local-chain qualification.
