# AE20 X1 url.extract route

Free/test gateway routes for the AE19 extraction contract:

- `url.extract.submit` takes `{ url, idempotencyKey }`, runs fit/SSRF first, and returns `{ jobId, status, digest? }` without waiting on a caller callback.
- `url.extract.poll` and `url.extract.result` read that job. A stored extraction includes `title`, `status`, `requestedUrl`, `fetch_mode`, and `completion`. The digest is sha256 of the stored canonical bytes.
- Price is 0. Quote and test do not fetch, capture, or set a payment.

The gateway tree belongs to N2. This package ships the provider and `proposed/gateway-url-extract.patch`. G4's 242007 patch is referenced and left unchanged.

```sh
cd experiments/ae20-x1-url-extract-route
npm install --ignore-scripts
node --test --test-concurrency=1 --test-timeout=120000
```

PostgreSQL on the local socket is the disposable store (`ae19_paid_continuation` in an `ae19g4_*` database). No signer, key, wallet, or settlement.
