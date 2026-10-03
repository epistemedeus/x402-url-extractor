# Attempt useful view 1005

One source-bound attempt at a time, read from an existing journal. This packet
does not rebuild the 301 causal proof, the 339 task producer, the 395
measurement, the 421 observer, or the 423 reader. It does not open a store,
mint a signer, infer an agent, or label a customer.

`attemptOf` is null. Operation `add923ae-3eb5-474b-8b3e-e376666dee83` is not
minted. The 3,692 external events in the committed 423 day are not a
denominator. `paid_success` is absent from that day's `byResult`, so the
stream numerator stays unresolved. A rare zero is not a census. A fixture or
retained owner-QA journal is not live production coverage.

Stage words:

| Stage | Word when the existing journal supports it |
| --- | --- |
| Attempt and delivery finish | producer-observed |
| Caller success flag | caller asserted |
| Fixed predicate on a separate receipt execution | classified |
| Existing grant or authorized later read | authorized |
| Missing, partial, mismatched, unpaid, or unjoined | unresolved |

Payment class and recognized revenue stay on the existing classifier. This
view does not recompute them and does not replay a payment.

## Cold command

From the repository root. This reads the retained two-task journal and prints
one task. It is covered inside that journal. `liveCoverage` stays
`unresolved`. A fixture pass is not live production coverage.

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/attempt-useful-view.mjs report \
  --receipt task-linked-delivery/experiments/free-task-observation-100421/evidence/two-objectives.retained.json \
  --task tdb90824374e9fc51c87f350974a336be759233d9b973a73b56c93cbaf7618f \
  --baseline task-linked-delivery/experiments/production-funnel-100423/evidence/baseline.stripped.json
```

The committed stdout of that command is
[evidence/one-useful-task.json](evidence/one-useful-task.json). Re-running the
command is the check. The file is not itself live coverage.

The seeded false join exits 2:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/attempt-useful-view.mjs reject \
  --input task-linked-delivery/experiments/attempt-useful-view-1005/test/seeded-false-join.json \
  --baseline task-linked-delivery/experiments/production-funnel-100423/evidence/baseline.stripped.json
```

Tests:

```sh
node --test --test-concurrency=1 task-linked-delivery/experiments/attempt-useful-view-1005/test/*.test.mjs
```

## Enrollment and the public seam

Released merchant head `32f07a836fb28e400d56b0e2e876043644bde31a` (merchant161,
merge of pull request 161) was fetched and inspected. Merchant160
`dc32cf7bf5fd76a5cd9047865f49b2462252897c` is historical only. Merchant161's
second parent is public-acquisition artifact
`4b7928f315be9d9ec7d14f2604eab1b7b236a63a`. This isolated branch applies the
three 421 patches and `export/MERCHANT161-SERVER.patch`. Released merchant161
is not published. Seller 0.4.1 is not edited. The public-acquisition artifact
is read, not copied. Live coverage and `paid_success` stay unresolved. Missing
stages stay unknown. See
[export/NEEDED-ENROLLMENT.md](export/NEEDED-ENROLLMENT.md),
[export/PUBLIC-SEAM.md](export/PUBLIC-SEAM.md),
[export/ROOT-INTEGRATION-DELTA.json](export/ROOT-INTEGRATION-DELTA.json), and
[export/MERCHANT161-INSPECTION.json](export/MERCHANT161-INSPECTION.json).

Check the executable delta from the repository root:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs check
```

The test-only clock-window fix `de4c2a1f5e52065273b677a8694913a98850dcf0` is
on `codex/task-observer-window-1003`. That commit is not an ancestor of this
branch or of merchant161. Merchant161's observer-test blob matches the fix
commit. This adapt does not apply the commit. Production freshness stays
900000 ms. Seller 0.4.1 stays `015f07d5a75d02a4e74709b17b2b1176501e92a5`.
