# AE35 HTTP delivery evidence wiring

Branch `codex/ae35-http-delivery-evidence-wiring`. Base `82a51274e7dc7a7600b90f1317a6be6b28442592`. Service version `1.23.52`. No production deploy was run.

The validation kernel is the existing `http-delivery-evidence/` module. This branch binds those live contracts at merchant boot and proves the mounted HTTP path. MCP typed delivery stays on `recordFromObservedMcpDelivery`. Canonical contracts are `bindMerchantHttpDeliveryContracts`, `generatedHttpSchema`, `evaluateResponseBytes`, `recordFromObservedResponse`, and `bindDeliveryObservation`. Generated JSON under `http-delivery-evidence/canonical-contracts.generated.json` is a pin snapshot. Production parse uses the live same-repo exports.

## 1. HTTP runtime composition

`server.js` calls `bindMerchantHttpDeliveryContracts()` before `createCommerceTelemetry()`. The bind installs the live parsers for:

| Route | Parser |
| --- | --- |
| `GET /extract` | `extractMcpOutputSchema` |
| `GET /read` | `readMcpOutputSchema` |
| `POST /extract/batch` | `extractBatchOutputSchema()` |
| `POST /lockfile-pin-delta` | `lockfilePinDeltaOutputSchema()` |
| `GET` and `POST /commerce/seller-integrity-audit` | `sellerIntegrityAuditOutputSchema()` |
| `GET /defi/morpho-position` | `morphoPositionOutputSchema()` |
| `GET /data/careers-board` | `careersBoardOutputSchema()` |

`server.js` then mounts `commerceTelemetry.middleware`. On each request that middleware:

1. Assigns the causal commerce event id before the handler runs.
2. For a paid route with a payment credential, digests the method, target, and raw body. The stored row keeps that digest, a credential fingerprint, and the existing optional source attribution.
3. Wraps `res.write` and `res.end` with `capturePaidEvidenceResponseDigest`. The hash is SHA-256 over `samedaydesk.commerce-paid-success-evidence.response.v1` plus every transferred body byte. Supported routes retain at most 10 MiB for classification. The seal is `sealStreamedHttpCapture` (`http_response_capture`).
4. On `finish`, a completed paid success (payment present, HTTP 2xx, replay flag clear) appends one v1 row to `COMMERCE_DATA_DIR/commerce-paid-success-evidence.ndjson`. That row stays `validatorVerdict: not_checked`, `validatorAuthority: none`, `validatorSource: http_runtime_not_checked`.
5. For a supported route, `buildHttpDeliveryValidationRecord` calls `recordFromObservedResponse`. That function checks the seal, calls `bindDeliveryObservation` with the same event id, calls `evaluateResponseBytes` on the retained prefix, and returns the canonical validation record.
6. `openStore(dataDir).appendValidation` appends that record to `COMMERCE_DATA_DIR/http-response-validation.v1.ndjson`.

The validation row stores `paidEvidenceId` (the v1 `id`), `requestDigest`, `responseDigest`, `settlementReference`, and `settlementClass`. `settlementClass` is `simulated` only when `HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS` is exactly `simulated`. Otherwise it is `real_unverified`. `settlementReference` is the lowercase transaction hash from the payment response, when that header carries one.

Join is `paidEvidenceId === historical.id` and `responseDigest === historical.responseDigest`. A 402 challenge, a payment replay, and a later purchase of the same URL each keep their own event id. Replay writes `replay_success` and does not append a validation. A challenge does not append a validation. A historical v1 row already on disk stays `not_checked` and gains a validation only when a new observation is sealed for that same id and digest. Restart reopens the same files and does not rewrite them.

Validation rows omit the raw URL, response body, payment token, and IP. `usefulness` stays `unknown`. `payerClass` is copied from the paid-evidence request classification. Source acquisition stays the existing optional attribution. A classifier throw is discarded and does not change the HTTP status, the price, or the v1 append.

## 2. Remote test results

Ran on this worktree with Node `v22.14.0`. These are local process tests. Production `agents.samedaydesk.com` was not called.

`node --test --test-concurrency=1 http-delivery-evidence.http.test.mjs`

```text
# tests 4
# pass 4
# fail 0
# duration_ms 10593.838693
```

Cases: mounted good, source refusal, truncated, unsupported content, and transport failure; invalid JSON and schema failure on the observed bytes (`real_unverified` when the settlement env is unset); restart with no backfill; same-receipt causality across replay and nearby 402s.

`node --test --test-concurrency=1 http-delivery-evidence/test/*.mjs`

```text
# tests 37
# pass 37
# fail 0
# duration_ms 6463.619972
```

`node --test --test-concurrency=1 startup-smoke.test.mjs`

```text
# tests 2
# pass 2
# fail 0
# duration_ms 2519.400249
```

## 3. Deploy and rollback

Commands only. Full copy: `AE35-DEPLOY-ROLLBACK.md`. Railway CLI was not installed and no deploy command was executed.

```sh
set -euo pipefail
git fetch origin codex/ae35-http-delivery-evidence-wiring
git checkout codex/ae35-http-delivery-evidence-wiring
git merge-base --is-ancestor 82a51274e7dc7a7600b90f1317a6be6b28442592 HEAD
git rev-parse HEAD
git status --porcelain
railway status
railway deployment list
railway up --ci --detach
curl --fail --silent --show-error --proto '=https' --max-time 10 \
  https://agents.samedaydesk.com/healthz
curl --silent --show-error --proto '=https' --max-time 10 \
  -D - -o /dev/null \
  'https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com'
```

Leave `HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS` unset. Do not backfill. Do not rewrite the v1 paid-success file.

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

Rollback returns to the parent revision through the same existing Railway service and leaves both ndjson files on the volume.
