# Useful result reuse

One read-only route: `GET /.well-known/useful-result-reuse/current.json`.
Scoped retrieval uses that same route with the existing
`x-samedaydesk-internal` grant, `x-samedaydesk-outcome-task`,
`x-samedaydesk-outcome-operation`, and `x-samedaydesk-outcome-cohort`.
There is no new price, SKU, or payment route. Purchase authorization and
replay limits stay on the existing handlers. `paymentSent` stays false in
this package.

The task label is an input to the existing HMAC task reference. It is not
stored. A caller digest is stored only as an assertion and does not establish
useful delivery. `independentRepeat` stays `unknown` until a whole-window
coverage read exists. A fetch is exposure, not adoption.
`recognizedRevenueAtomic` stays `0`.

## Source-native commands

```sh
export USEFUL_RESULT_TOKEN="$(openssl rand -hex 32)"
export DATA=/tmp/useful-result-reuse
mkdir -p "$DATA"
printf '%s\n' "$USEFUL_RESULT_TOKEN" > "$DATA/token"
node useful-result-reuse/cli.mjs bind \
  --data "$DATA" --token-file "$DATA/token" \
  --task caller-unpaid-receipt --operation read-unpaid-receipt \
  --method GET --route /read \
  --schema samedaydesk.useful-result.v1 --schema-version 1 \
  --class owner --outcome-file useful-result-reuse/fixtures/positive-outcome.json
node useful-result-reuse/cli.mjs retrieve \
  --data "$DATA" --token-file "$DATA/token" \
  --task caller-unpaid-receipt --operation read-unpaid-receipt --class owner
node useful-result-reuse/cli.mjs share \
  --data "$DATA" --token-file "$DATA/token" \
  --task caller-unpaid-receipt --operation read-unpaid-receipt --class owner
node useful-result-reuse/cli.mjs consume \
  --data "$DATA" --token-file "$DATA/token" \
  --share "$SHARE_ID" --task later-different-task \
  --operation read-unpaid-receipt --class unknown \
  --method GET --route /read \
  --schema samedaydesk.useful-result.v1 --schema-version 1 \
  --source-sha "$SOURCE_SHA"
node useful-result-reuse/cli.mjs reject-seeded \
  useful-result-reuse/fixtures/seeded-forged-success.json
```

Restart is a second process with the same `--data` directory. `retrieve`
recomputes the delivery-outcome join. A stored decision bit is not execution
and not current payment authority.

`COMMERCE_DATA_DIR` and `COMMERCE_INTERNAL_TOKEN` are the server's data
directory and the existing producer grant. The route is also named from
`GET /mcp` as `usefulResultReuse`.

## Root release

Do not merge this branch and do not deploy it from the worker. After review,
Root can run the process with the existing merchant environment. Confirm
`GET /extract` is still 402, `HEAD` of the retained-task archive is still
107420 bytes with an empty body, and `productionHosted` on the public
acquisition index is still false. Then run the canary. Rollback is removing
`useful-result-reuse/` and the server mount, plus deleting
`useful-result-private.ndjson`, `useful-result-shared.ndjson`, and
`useful-result-metrics.ndjson` in the commerce data directory. The forward
task-reference file may contain new opaque links from this writer; leaving
them does not change payment handling.
