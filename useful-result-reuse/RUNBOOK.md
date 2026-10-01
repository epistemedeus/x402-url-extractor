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
`GET /mcp` as `usefulResultReuse`. The owner instrumentation above still
requires that token. It is not the customer retrieval path.

## Customer-held continuation

`GET /chain/transaction-receipt` is unchanged as a paid operation. Price,
product `samedaydesk-transaction-receipt`, and the receipt JSON body stay as
they are. A caller who wants the useful body back after restart sends
`x-samedaydesk-retain-result: 1` on that same request. A query parameter does
not opt in. Optional `x-samedaydesk-outcome-task` is an HMAC input only.
Optional `x-samedaydesk-retain-until` is an ISO time inside the server window
(default seven days). User-Agent, wallet, and task notes are ignored.

Retention runs when the paid response is flushed after settlement. HTTP 402
and facilitator 502 clear the handler body and write no customer record. A
handler failure such as `rpc_unavailable` returns the receipt body with
`x-samedaydesk-retain-result: execution_failed` and no grant. `not_found` can
be retained as a useful negative; `paidValidDelivery` stays false.
`paid_valid_delivery` is recorded only when the rail presented a settlement
header and the handler decision is `found` with receipt status `success` or
`reverted`. That counter is owner QA. It does not increment `valid_delivery`,
`verified_settlement`, or `paid_settlement`, and `recognizedRevenueAtomic`
stays `"0"`. `historicalRevenue` stays `"unknown"`.

The grant is 64 hex characters, returned once in
`x-samedaydesk-result-grant`, with `x-samedaydesk-result-id` and
`x-samedaydesk-result-expires`. The server stores only `sha256` of the grant.
It is not a payment, not a second charge, and not authority for another
customer, route, or method. Putting it in the URL returns `credential_in_url`
and does not look up a record. Replaying the same payment returns
`X-Payment-Replay: hit` and does not mint a second grant.

```sh
# Unpaid. The retain header does not change the 402 challenge.
curl -sS -D - -o /dev/null \
  -H 'x-samedaydesk-retain-result: 1' \
  "$ORIGIN/chain/transaction-receipt?transactionHash=$TX&network=base"

# After the caller's own payment-signature on that same URL, also send:
#   x-samedaydesk-retain-result: 1
# Read x-samedaydesk-result-grant from the response headers once.

# Later process. Only the origin and that grant. No internal token.
curl -sS -D - \
  -H "x-samedaydesk-result-grant: $GRANT" \
  "$ORIGIN/.well-known/useful-result-reuse/retained"

# Precise refusals use the same header plus an assertion header.
# wrong_result: x-samedaydesk-result-id
# wrong_method: x-samedaydesk-bound-method
# wrong_resource: x-samedaydesk-bound-resource

curl -sS -D - -X POST \
  -H "x-samedaydesk-result-grant: $GRANT" \
  -H 'x-samedaydesk-result-action: revoke' \
  "$ORIGIN/.well-known/useful-result-reuse/retained"

# Optional. Address-free compatibility only. Never the raw receipt.
curl -sS -D - -X POST \
  -H "x-samedaydesk-result-grant: $GRANT" \
  -H 'x-samedaydesk-result-action: share-knowledge' \
  "$ORIGIN/.well-known/useful-result-reuse/retained"

curl -sS -D - -X POST \
  -H "x-samedaydesk-result-grant: $GRANT" \
  -H 'x-samedaydesk-result-action: correct-knowledge' \
  "$ORIGIN/.well-known/useful-result-reuse/retained"
```

Public readback, no grant:

```sh
curl -sS -D - -o /dev/null "$ORIGIN/.well-known/useful-result-reuse/retained"
curl -sS "$ORIGIN/.well-known/useful-result-reuse/current.json"
```

The first is `401` `grant_required`. The current document keeps
`schema` `samedaydesk.useful-result-reuse.current.v1`,
`hostedReuseVerified` false, `productionHosted` false,
`customerRetentionHostedVerified` false, `recognizedRevenueAtomic` `"0"`,
and `historicalRevenue` `"unknown"`. New anonymous fields are
`customerRetention` (`credentialInUrl` false, `internalTokenRequired` false,
`price` `"free"`), `compatibility`, `compatibilityCorrections`, and
`compatibilityRevocations`. `knowledge` stays the explicit owner shares.
`GET /mcp` adds `usefulResultGrant`. `GET /` JSON adds
`machineCommerce.usefulResultRetention` with `current`, `read`,
`credentialInUrl` false, `internalTokenRequired` false, and `price` `"free"`.
OpenAPI adds `getUsefulResultReuseCurrent`, `readRetainedUsefulResult`, and
`mutateRetainedUsefulResult`. Human HTML is unchanged.

A different later process reads the public compatibility item, checks
corrections and revocations, and runs `transactionReceipt` on its own capture.
`useful-result-reuse/compatibility-consumer.mjs` is that process. It refuses
`COMMERCE_DATA_DIR`, `COMMERCE_INTERNAL_TOKEN`, and `USEFUL_RESULT_GRANT`.
`executionSaved`, `observedSaving`, `usefulTransferred`, and
`paymentPermitted` stay false. The closed H15 hash remains
`closed_sponsored_reference` and is not a purchase.
`useful-result-reuse/grant-caller.mjs` is the cold HTTP reader: it needs
`USEFUL_RESULT_BASE` and `USEFUL_RESULT_GRANT` only.

Activation uses the existing writable `COMMERCE_DATA_DIR`. No new secret.
`COMMERCE_INTERNAL_TOKEN` of at least 32 bytes writes an opaque task ref in
`commerce-outcome-task-ref.ndjson`. A shorter or absent token still retains;
the join is `unbound_artifact`. Customer read, revoke, share, and correct do
not accept that token. Customer rows are `useful-result-customer.ndjson`
(mode 0600, 16384-byte records). The older private, shared, and metric files
stay at 4096 bytes.

Seeded refusal, no payment:

```sh
node useful-result-reuse/cli.mjs reject-seeded-paid \
  useful-result-reuse/fixtures/seeded-unverified-paid-delivery.json
```

Exit 0 means the unverified `paidValidDelivery` claim was refused.

## Root release

Do not merge this branch and do not deploy it from the worker. After review,
Root can run the process with the existing merchant environment. Confirm
`GET /extract` is still 402, `HEAD` of the retained-task archive is still
107420 bytes with an empty body, and `productionHosted` on the public
acquisition index is still false. Then run the canary, including the unpaid
receipt probe and the grant-less retained read. Rollback of this continuation
is reverting the retention hook, the `retained` route, and the machine fields
above. Delete `useful-result-customer.ndjson`. Leave `current.json` and
`useful-result-private.ndjson`, `useful-result-shared.ndjson`, and
`useful-result-metrics.ndjson`. Opaque task-reference lines do not change
payment handling. Removing `useful-result-reuse/` and the whole server mount
is the older full rollback and also removes the owner canary.
