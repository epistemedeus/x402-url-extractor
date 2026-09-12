# Release instructions

Deployment remains Root's next gate. This branch does not flip production.

## Catalog counts (do not mix these)

| Envelope | Paid HTTP | MCP tools | How |
| --- | ---: | ---: | --- |
| Signed deployment statement / default-off flags | 25 | 22 | `EXTRACT_BATCH_ENABLED` unset, `LOCKFILE_PIN_DELTA_ENABLED` unset. Includes disabled `POST /extract/batch` as a statement row, not a live path. |
| Current production (`agents.samedaydesk.com`, GET 2026-09-11) | 26 | 23 | `EXTRACT_BATCH_ENABLED=1`. Live `/extract/batch`. No lockfile route. |
| This branch, lockfile on, batch off (local tests) | 26 | 23 | `LOCKFILE_PIN_DELTA_ENABLED=1` only. |
| This branch, lockfile on, production batch kept | 27 | 24 | Both flags on. This is the intended hosted enable. |

This branch does not rewrite the signed 25-route statement.

## Enable the hosted lockfile compare

1. Ship this branch to the existing Railway service (Root).
2. Set `LOCKFILE_PIN_DELTA_ENABLED=1`.
3. Keep `EXTRACT_BATCH_ENABLED=1` if production already has batch (it does). Do not unset it to “match 25/22”.
4. Optional: `LOCKFILE_PIN_DELTA_PRICE=$0.005` (default). Margin is not proven.
5. Keep one process and persistent `COMMERCE_DATA_DIR`.
6. Do not set production CDP/xpay credentials in tests. Do not redeem overage.
7. After enable, free discovery must show `POST /lockfile-pin-delta` on `/openapi.json`, `/.well-known/x402`, `/api/actions`, MCP `tools/list` (`lockfile_pin_delta`), and paid-action-effects as **x402-only**. It must be absent from `/mpp-openapi.json` and must not send MPP `WWW-Authenticate`. A missing default-OpenAPI path means the lockfile flag is off; do not advertise a fixture as live.
8. Re-sign the service deployment statement only when Root wants the new route in the signed envelope. Until then, live evidence can describe the hosted POST without claiming the old statement listed it.

## Buyer check

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs --base-url "$PUBLIC_URL" discover
```

Expect `enabled: true` and unpaid `402`. That is not a sale.

## Rollback

Unset `LOCKFILE_PIN_DELTA_ENABLED` or set it to `0`. Production returns to the 26/23 extract_batch envelope if that flag stays on. Default-off catalogs are 25/22. Existing extract and batch prices stay as they were.
