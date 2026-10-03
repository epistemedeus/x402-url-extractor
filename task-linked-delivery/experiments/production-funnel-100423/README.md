# Production funnel baseline 100423

Read-only baseline for one producer-complete window on the existing
`GET /v0/commerce-demand.json` route, plus the missing per-attempt join.
No merchant store, dashboard, daemon, or payment. Seller 0.4.1 is unchanged.
The 421 shared patches stay unapplied.

## Measured window

Acquisition `2026-10-03T07:56:45.289Z`. Producer `generatedAt`
`2026-10-03T07:56:45.096Z`. Covered request: `days=1`,
`2026-10-02T07:56:45.096Z` through `2026-10-03T07:56:45.096Z`,
`requestedWindowCoverage: complete`. The stream's own conservative complete
UTC-day bound is empty (`retainedDurationWholeDays: 0`). A 90-day request is
not this denominator.

Raw response SHA-256 `a331dbe47a62259b8bcadea1686fe10a4ef8d6346445bdd29b358d451f1f290a`
(39894 bytes). The 30-day context read is SHA-256
`d25612cd5e970a024f9d1fff83c6d86677467ce0a66bb0942f5b54722273dab9`
(40857 bytes). Neither body is stored. The stripped projection is
[evidence/baseline.stripped.json](evidence/baseline.stripped.json).

| Plane | What the bytes support | What they do not support |
| --- | --- | --- |
| Stream events in the covered day | 3692 external; `byResult` challenge 1207, discovery 1533, validation failure 214, unmatched 538, protocol discovery 200. Challenge actor hashes 170. | Unique agents or paying customers. `byResult` has no `paid_success` key, so that numerator is unknown, not zero. |
| Challenge source counter, same day, different field | generic-agent-indexer 2897, coinbase-bazaar 48, declared-receipt-referral 42, mpp-ecosystem 8 | The same quantity as `byResult.challenge`. Do not add the counters. |
| Rare rows inside the covered day | Payment-header field is 0. Continuity is not proven, so this is not a census. | Buyer-valid delivery, usefulness, retention, later use. |
| Rare file context, not the covered day | Retained file spans complete UTC days 2026-09-11 through 2026-09-30 (20). Wide request shows 102 header rows, 50 parseable attempts, 12 seller-observed paid successes, 9 actor hashes, 80 validation failures, 10 challenges. | A covered census. `independentOperatorCount` is null. Usefulness is unknown. |
| Settlement ledger | 43 reconciled rows, `1027000` atomic, not revenue. Validation 1, internal 12, unclassified 30. | A count inside the covered day. Sponsored, recruited, and independent classes are absent, not zero. The closed 200000 atomic sponsored expense is a separate pin and is not one of the 43. |
| Customer plane | All three fields are null. | Attributable customers, buyer-valid delivery, repeat independent customers. |

Journey numerators for attempts, delivery, independent usefulness, authorized
retention, later use, settlement, and paying customers are null. The missing
link is `per_attempt_public_call_identity`: no public id joins one live attempt
across those stages. Sluzen's private per-attempt `callId` is described at
hebridean-tech/x402-pulse#1 comment 5962999853. The public example, the
cross-rail join, and the later-repeat join are absent and stay absent.

Cost of this read: two HTTPS GETs. No XRP, no USDC, recognized revenue 0.

## Commands

From the repository root:

```sh
node --test --test-concurrency=1 task-linked-delivery/experiments/production-funnel-100423/test/*.test.mjs
node task-linked-delivery/experiments/production-funnel-100423/bin/funnel-baseline.mjs read --write-evidence
node task-linked-delivery/experiments/production-funnel-100423/bin/funnel-baseline.mjs reject --input task-linked-delivery/experiments/production-funnel-100423/test/seeded-false-complete.json
```

`read` exits 0 and prints the stripped baseline. `reject` exits 2. The seeded
proposal treats the ledger as 43 paying customers, the rare zero as a census,
actor hashes as agents, and a Sluzen id as a cross-rail join. All of those are
refused. Re-running `read` moves the rolling day and replaces the committed
snapshot; commit a new snapshot only after checking it.

The next visitor step is [NEXT-VISITOR.md](NEXT-VISITOR.md). Root owns
outreach, spending, and release.
