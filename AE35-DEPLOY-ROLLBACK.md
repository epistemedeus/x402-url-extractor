# AE35 deploy and rollback

Commands for Root. This worker did not deploy. The Railway CLI is absent here. Use the existing Railway service that receives `https://agents.samedaydesk.com` (alias `https://x402-url-extractor-production.up.railway.app`). Do not create a project, service, or volume. Entry stays `node server.js`. `COMMERCE_DATA_DIR` stays the existing volume.

Do not merge, rebase, or deploy `master`, `codex/ae19-g4-paid-continuation`, or `codex/ae24-j9-gateway-verified`.

```sh
set -euo pipefail
git fetch origin codex/ae35-http-delivery-evidence-wiring
git checkout codex/ae35-http-delivery-evidence-wiring
git merge-base --is-ancestor 82a51274e7dc7a7600b90f1317a6be6b28442592 HEAD
git rev-parse HEAD
git status --porcelain
```

Leave `HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS` unset on the production service. Unset records `settlementClass` `real_unverified`. Do not set it to `simulated`. Do not rewrite `commerce-paid-success-evidence.ndjson`. Do not backfill `http-response-validation.v1.ndjson`.

```sh
set -euo pipefail
railway status
railway deployment list
railway up --ci --detach
```

```sh
set -euo pipefail
curl --fail --silent --show-error --proto '=https' --max-time 10 \
  https://agents.samedaydesk.com/healthz
curl --silent --show-error --proto '=https' --max-time 10 \
  -D - -o /dev/null \
  'https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com'
```

The unpaid extract request is a 402. It writes no validation row.

Rollback redeploys the parent revision through the same service. Leave both ndjson files on the volume.

```sh
set -euo pipefail
git checkout 82a51274e7dc7a7600b90f1317a6be6b28442592
railway up --ci --detach
curl --fail --silent --show-error --proto '=https' --max-time 10 \
  https://agents.samedaydesk.com/healthz
curl --silent --show-error --proto '=https' --max-time 10 \
  -D - -o /dev/null \
  'https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com'
```

Parent `82a51274e7dc7a7600b90f1317a6be6b28442592` already seals paid HTTP bodies inside commerce telemetry. Rollback removes the explicit `server.js` boot call. It does not delete validation rows and it does not rewrite v1 paid-success bytes.
