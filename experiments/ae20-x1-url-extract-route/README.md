# AE20 X1 url.extract route

Free/test gateway routes for the AE19 extraction contract:

- `url.extract.submit` takes `{ url, idempotencyKey }`, runs fit/SSRF first, and returns `{ jobId, status, digest? }` without waiting on a caller callback.
- `url.extract.poll` and `url.extract.result` read that job. A stored extraction includes `title`, `status`, `requestedUrl`, `fetch_mode`, and `completion`. The digest is sha256 of the stored canonical bytes.
- Price is 0. Quote and test do not fetch, capture, or set a payment.

The gateway tree belongs to N2. This package ships the provider and `proposed/gateway-url-extract.patch`. G4's 242007 patch is referenced and left unchanged.

```sh
cd experiments/ae20-x1-url-extract-route
npm ci
AE20_NEO_DIR=<neo clone> AE20_GATEWAY_NODE_MODULES=<machine-gateway node_modules> \
  node --test --test-concurrency=1 --test-timeout=120000 test/*.test.mjs
```

`AE20_NEO_DIR` is the neo clone used to archive `services/machine-gateway` and `packages/journey-x402-async`. `AE20_GATEWAY_NODE_MODULES` is that gateway's `node_modules` directory. Both are required. An unset variable throws a clear error and does not fall back to `/tmp` or `/home/ubuntu`. Each temporary gateway copy then runs lockfile `npm ci` (`npm-shrinkwrap.json` or `package-lock.json`). `npm ci` in this package also installs `experiments/ae19-paid-continuation` from its lockfile, because the suite imports that contract.

G4's suite reads its checkouts from the environment: `AE19_GATEWAY_REPO` (neo checkout whose `HEAD` is `7e5078bb`) and `AE19_NEO_ROOT` (clone that contains `1b5fd425`). Maintenance roots are `AE19_MAINTENANCE_ROOT`, `AE19_SDS_ROOT`, `AE19_MERCHANT_INPUT`, and `AE19_GATEWAY_INPUT`. When those are unset, the maintenance test stays `pending-join`.

PostgreSQL on the local socket is the disposable store (`ae19_paid_continuation` in an `ae19g4_*` database). No signer, key, wallet, or settlement.
