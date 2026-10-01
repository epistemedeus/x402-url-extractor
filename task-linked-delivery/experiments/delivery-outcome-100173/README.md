# Delivery outcome join

Replayable join from a known experiment or task pseudonym through discovery
or download, a valid call, a useful result, an optional explicit purchase
attempt, settlement, and a later useful call. The next revenue experiment
reads this readout. It is not a dashboard, a warehouse, or a customer claim.

The measurement question is which existing event shows that an agent got a
useful task result and came back. A download, an HTTP 402, an HTTP 200, a
native CLI exit 0, a typed handler success, a settlement transaction, and a
schema-valid forward delivery each answer a different question. Usefulness
stays unknown unless the row carries an explicit task criterion that this
consumer already knows. Unknown stays unknown.

## What it reuses

Pilot234, commit `4f5f631ec32d4738e8dee4cc5964ce4b5ecb55a6`, is imported from
`tools/ops/three-site-settlement-join/measure/src/outcome-binding.mjs`. This
package does not modify that join. Forward v2 lines keep the closed key set.
Task pseudonyms are sibling records with schema
`samedaydesk.outcome-task-ref.v1` and are split out before that importer runs.
A controlled five-stage join still has unknown usefulness and does not prove
external demand.

Public commerce demand stays an aggregate. Customer counts stay null.
Unclassified settlements stay unclassified. A wallet, an actor hash, and a
public reviewer alias are not an identity. Effort planes stay separate and
are not summed. Recognized revenue atomic on this readout is `0`.

## What it refuses

Restricted fields (prompts, authorization, contact details, wallets, and the
same family) are not copied into the readout. A directive to relabel
unclassified settlement as independent use, to book settlement as revenue, to
count CLI exit 0 as an install, or to treat HTTP 200 as useful is rejected.
One contaminated event becomes unjoinable and its values are not echoed.
Real public bytes and synthetic events are not mixed in one snapshot.

Eligibility is defined before conversion. The cited twelve merchant doors
were free-sufficient, so the paid-operation denominator is zero and the
conversion rate is null. That is a sample negative, not proof that paid
demand is universal or absent. A tarball download is not an install, a
launch, or verified reuse.

## Run

From this directory, on Node 22:

```bash
node --test --test-concurrency=1 test/*.test.mjs
node bin/delivery-outcome.mjs replay --input fixtures/real/snapshot.json
node bin/delivery-outcome.mjs replay --input fixtures/real/snapshot.json --view experiment-input
node bin/delivery-outcome.mjs replay --input fixtures/synthetic/seeded-relabel.json
```

The real command prints the operator readout and exits 0. Coverage of the
public window remains incomplete. The seeded command prints a rejection on
stderr and exits 2. Exit 0 means the snapshot was replayed. It does not mean
the service is ready or that a customer paid.

`fixtures/real/commerce-demand.json` is the bounded public body observed at
`generatedAt` `2026-10-01T12:13:51.557Z`. Replaying it does not fetch the
network again.

## Merchant patch

`export/ROOT-MERCHANT-TASK-REF.patch` is the missing writer input for Root.
The deployed outcome binding accepts an operation id and a cohort, and it has
no task pseudonym, so an unpaid call cannot be joined without guessing.
Forward v2 cannot grow a field without breaking the accepted importer. The
patch adds an optional internal header `x-samedaydesk-outcome-task` and a
sibling file `commerce-outcome-task-ref.ndjson`. Wallet-shaped, `bc1`, and
`@` values are stored as no task. The header is absent for ordinary traffic,
and then nothing is written. The forward file is not rotated and does not
receive the task schema. Payment handlers and the job 166 mount are
unchanged.

Apply it from the x402-url-extractor tree that contains
`commerce-outcome-binding.mjs`. This repository does not apply it.

```bash
patch -p1 --dry-run < export/ROOT-MERCHANT-TASK-REF.patch
```

The patch is based on merchant commit
`950fe15b5c936a8f882b3c949d1fb380d3306ad9`. Root merges and deploys it.
