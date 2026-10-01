# Useful result reuse

One read-only route: `GET /.well-known/useful-result-reuse/current.json`.
Scoped retrieval of a supplied outcome uses that same route with the existing
`x-samedaydesk-internal` grant, `x-samedaydesk-outcome-task`,
`x-samedaydesk-outcome-operation`, and `x-samedaydesk-outcome-cohort`.
There is no new price, SKU, or payment route. Purchase authorization and
replay limits stay on the existing handlers. `paymentSent` stays false in
this package.

The grant is the existing producer token. A public later consumer does not
receive it. Scoped retrieval stays owner instrumentation. The public document
exposes only an explicitly shared derivative.

## Why this result

The supplied six-field outcome stays a controlled observation. Rehashing its
`code`, status, and disposition does not make `valid_delivery` server
execution, an independent replay, or a paid settlement. A different task that
tries to apply that task-scoped share still gets `different_task` and
`usefulTransferred: false`.

The useful bytes are the closed H15 Base receipt already pinned at
`task-linked-delivery/tools/ops/three-site-settlement-join/measure/pins/sponsored-outflow.json`
(`0x593559ea7a19277645a76e41aa29e713ed219db1f97e4be29c9dac9cf6cd4b37`, block
52009071, 200000 atomic USDC, claim closed). The existing
`transactionReceipt` operation normalizes a public historical read. The
settlement ledger, seller-integrity purchase gate, and delivery-outcome
joiner stay on their own jobs: this expense is not revenue, and the joiner
does not execute a receipt. `GET /chain/transaction-receipt` is not called.
The captured body is `useful-result-reuse/fixtures/h15-base-receipt.json`.

The owner authorizes one minimal derivative (source, MIT license,
implementation `transaction-receipt.mjs#transactionReceipt`, address-free
evidence, correction). A different accounting task, in its own directory,
re-runs that operation on its own copy of the public receipt. It gets no
producer directory, token, payment permission, or new provider result.
`executionSaved` stays false. `paid_settlement` and `verified_settlement`
stay 0. `valid_delivery` counts only the supplied observation.

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
node useful-result-reuse/cli.mjs verify-settlement \
  --data "$DATA" --token-file "$DATA/token" \
  --task owner-closed-settlement --operation normalized-transaction-receipt \
  --class owner --receipt-file useful-result-reuse/fixtures/h15-base-receipt.json
node useful-result-reuse/cli.mjs share-knowledge \
  --data "$DATA" --token-file "$DATA/token" \
  --task owner-closed-settlement --operation normalized-transaction-receipt \
  --class owner
node useful-result-reuse/later-consumer.mjs \
  --derivative "$DERIVATIVE" --receipt "$RECEIPT_COPY" \
  --task reconcile-closed-expense --operation account-closed-expense --compare
node useful-result-reuse/cli.mjs read-public
```

`read-public` performs one unpaid `eth_getTransactionReceipt` and block read
on the public Base RPC and compares it with the fixture. It does not submit
a transaction or call a paid route. The later consumer's directory receives
the derivative and its own receipt copy, not `$DATA`.

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
