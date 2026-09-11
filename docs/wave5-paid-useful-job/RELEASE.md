# Release instructions

Deployment remains Root's next gate. This branch does not flip production.

## What is already true on master

25 paid HTTP operations and 22 MCP tools. Signed deployment statement still
lists those standard routes, including disabled `POST /extract/batch`. This
branch does not rewrite that statement.

## Enable the hosted lockfile compare

1. Ship this branch to the existing Railway service (Root).
2. Set `LOCKFILE_PIN_DELTA_ENABLED=1`.
3. Optional: `LOCKFILE_PIN_DELTA_PRICE=$0.005` (default). Do not copy D26's
   `0.003` as a proven floor.
4. Keep one process and persistent `COMMERCE_DATA_DIR`.
5. Do not set production CDP/xpay credentials in tests. Do not redeem overage.
6. After enable, free discovery must show `POST /lockfile-pin-delta` on
   `/openapi.json`, `/.well-known/x402`, `/api/actions`, MCP `tools/list`
   (`lockfile_pin_delta`), and paid-action-effects. A missing path means the
   flag is off; do not advertise a fixture as live.
7. Re-sign the service deployment statement only when Root wants the new
   route in the signed 25-route envelope. Until then, live evidence can
   describe the hosted POST without claiming the old statement listed it.

## Buyer check

```bash
node examples/lockfile-pin-delta-buyer/cli.mjs --base-url "$PUBLIC_URL" discover
```

Expect `enabled: true` and unpaid `402`. That is not a sale.

## Rollback

Unset `LOCKFILE_PIN_DELTA_ENABLED` or set it to `0`. Default catalogs return
to 25/22. Existing extract and batch prices stay as they were.
