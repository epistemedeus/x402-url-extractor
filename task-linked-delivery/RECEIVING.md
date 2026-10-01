# Task-linked delivery receiving

Sibling stream `commerce-outcome-task-ref.ndjson`, rotated once to
`commerce-outcome-task-ref.1.ndjson`, mode `0600`, on the existing commerce
telemetry queue. Forward v2 records are unchanged. A task link is written
only after `x-samedaydesk-internal` matches the configured producer token
(at least 32 bytes) and the operation id and cohort already pass. The optional
header is `x-samedaydesk-outcome-task`.

The stored `taskRef` is an HMAC-SHA256 of the accepted label, keyed by that
same token. The epoch id is the first 16 hex characters of SHA-256 over
`samedaydesk.outcome-task-ref.epoch.v1` and the token. Replacing the token
starts a new epoch. This process does not keep old tokens. Duplicate
admission covers only event ids still in the current file or the one rotated
file. A third rotation drops the oldest generation. Dropped ids are not kept
in memory after restart. A failed append is reconciled from those files and
does not truncate them, replay a payment, or fail the commerce event.

Labels that fold to an address, mailbox, URL, or token are not stored.
Uppercase does not make one of those values acceptable. A missing or forged
producer token writes no task link. Historic rows without a token stay
unknown. Paid success, schema-valid delivery, a useful task result,
acquisition, and a later retained use stay separate. Usefulness on forward v2
stays `unknown`. A caller label is not independent demand.

The partial readout's recognized revenue atomic is `0`. That is not the
historic banked revenue of `10.955` USDC on the Pilot ledger at
`0c136a96dfdecf72e141dd9078c2f6c2e38ca8aa`
(`portfolioMandate.bankedRevenueUsdc`). The closed H15 sponsored expense
stays `200000` atomic, claim `closed`, and is not revenue. Public settlement
`1027000` atomic is observed and is not revenue. Independent conversion on
this package is unknown. Coverage that is not complete has no rate.

No payment, deploy, price, or route change is part of these commands.
`HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS=simulated` is the test boundary used
by the existing forward writer. It does not submit a transaction.

```bash
export TASK_LINK_DATA_DIR=/tmp/task-linked-delivery
export TASK_LINK_TOKEN="$(openssl rand -hex 32)"
export HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS=simulated
mkdir -p "$TASK_LINK_DATA_DIR"
node task-linked-delivery/bin/produce-controlled.mjs
node task-linked-delivery/bin/consume-readout.mjs
node --test --test-concurrency=1 commerce-outcome-binding.test.mjs
node --test --test-concurrency=1 commerce-events.test.mjs
node --test --test-concurrency=1 http-delivery-evidence.http.test.mjs
node --test --test-concurrency=1 task-linked-delivery/receiving.test.mjs
node --test --test-concurrency=1 task-linked-delivery/experiments/delivery-outcome-100173/test/join.test.mjs
```

`produce-controlled.mjs` refuses a token under 32 bytes and refuses a data
directory that already contains `commerce-events.ndjson` unless
`TASK_LINK_ALLOW_NONEMPTY=1`. Do not point it at the live merchant directory
in this assignment. The consumer exits 1 when a qualified check fails. The
vendored replay of `fixtures/synthetic/seeded-relabel.json` exits 2.
