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
one task. It is covered inside that journal. `liveCoverage` stays false.

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

Root's released merchant head `dc32cf7bf5fd76a5cd9047865f49b2462252897c` was
fetched and inspected. The 421 observation mount is not on it. This packet
does not edit `server.js` or the index. The server delta is prepared and
unapplied; production enrollment is waiting. See
[export/NEEDED-ENROLLMENT.md](export/NEEDED-ENROLLMENT.md),
[export/PUBLIC-SEAM.md](export/PUBLIC-SEAM.md), and
[export/ROOT-INTEGRATION-DELTA.json](export/ROOT-INTEGRATION-DELTA.json).

The test-only clock-window fix `de4c2a1f5e52065273b677a8694913a98850dcf0` is
on `codex/task-observer-window-1003`. It is not on this branch and not on
released master. It is not applied. Production freshness stays 900000 ms.
Seller 0.4.1 stays `015f07d5a75d02a4e74709b17b2b1176501e92a5`.
