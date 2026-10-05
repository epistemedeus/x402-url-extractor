# Incoming cash trace, 2026-10-05

Status: one new unclassified settlement. It is not the earlier extract pair, not the treasury payout, and not recognized revenue.

Native run: job `ROOT-1005-INCOMING-CASH-TRACE`, session `b5c0a8a2-8814-41b2-b894-398139dd9b55`, hostname `cursor`, enrollment file `enrollment-cloud-f.json`, model `grok-4.7`, effort `xhigh`. Merchant source `355c525a6112ad271ac58fe69016a8fb1b1a4dd3`. Pilot tip `3c5e484d2b08dc7e0a36ac8a51dcb4eac464200e` (2026-10-05T05:37:33Z). The three named adjudication blobs match that tip. Railway CLI is not installed and no Railway token is present. `COMMERCE_INTERNAL_TOKEN` is unset, so the native attempt-cut read was not called.

## Join

Received source, paid request, and chain delivery are one event:

| Fact | Value |
| --- | --- |
| Settlement | `0x2439870db33f6e81157beffed44c26b02aad663aff595424929ac04f9030008d` |
| Block / time / log | 52195376 / 2026-10-05T06:01:39Z / 322 |
| Call | USDC `transferWithAuthorization` (`0xe3ee160e`) on Base |
| Amount | 20000 atomic / 0.020 USDC |
| Route | `GET /defi/morpho-position` |
| Protocol / class | x402 / unclassified |
| HTTP result | `paid_success` (payment present and HTTP 2xx) |
| Event id | unknown |
| Delivery class | not emitted |
| Buyer predicate / usefulness | unknown / unknown |

The public ledger moved from 46 settlements / 1047000 atomic at 2026-10-04T17:34:41Z to 47 / 1067000 at 2026-10-05T06:32:03.995Z. The only route that changed is `/defi/morpho-position`, 6/120000 to 7/140000. Unclassified moved 33/460000 to 34/480000. Internal and validation did not move. Extract stayed at 20/190000.

From block 52153088 (2026-10-04T06:32:03Z) through block 52195740, USDC transfers into the treasury are exactly three. Two are the already received 0.005 extract settlements. The third is this 0.020 transaction. `missingSettlementReferencePaidSuccesses` is 0 and the reconciler's last scan reports 0 issues. The new ledger row cannot point at a different 20000 transfer inside that window, because no other one exists.

The authorization arguments match the Transfer log: 20000 atomic, recipient is the treasury, sender is neither the treasury nor the broadcasting account. `validAfter` is 2026-10-05T06:00:36Z and `validBefore` is 2026-10-05T06:03:36Z. `base.drpc.org` returns the same successful receipt, block, log, and amount. Replay successes in the window are 0.

## What it is not

The treasury balance on `mainnet.base.org` is 24.493292 at block 52195370, 24.393292 at 52195371, and 24.413292 at 52195376 and at the lead block 52195740. ETH at 52195740 is 0.000248350976449192. The 0.100000 drop is outgoing plain `transfer` `0x6c51682c8678b4779548e8b717b327ab1b9dfb06141850cce92eb220075e3a20` at 2026-10-05T06:01:29Z. That payout is not this settlement and is not counted. The following 0.020 is the only incoming in the lead window 52195371..52195740. No sender, recipient, or query value is exported.

## Caller

The one-day stream coverage is complete. Paid successes are extract 2 and morpho-position 1, all unclassified, all x402, all `direct-or-unattributed`. Traffic provenance paid successes are verified internal 0, self-reported owner-monitor 0, and unattributed external 3. This payment is the unattributed morpho success. No verified owner or internal marker is present. Missing that marker does not prove an outside buyer.

The two extract transfers share an on-chain sender. This transfer's sender is different. `paidSuccessActors` is 2 and `repeatPaidSuccessActors` is 1, which is the extract pair. This payer is not a repeat inside the window. Continuity with the six earlier morpho settlements was not checked; that would be a payer census. `independentPaidSuccessActors` remains 0. Recognized revenue stays 10.955 USDC. Wallet balance is not revenue. This row is one unclassified settled-use observation.

## Delivery, compared with the extract pair

The October 4 extract pair was schema-pass `truncated_partial`, 0.005 USDC, usefulness unknown, buyer predicate unknown. Those facts stay on those two event ids. They are not copied here.

`buildHttpDeliveryValidationRecord` returns null unless `isSupportedTarget` is true. That set is `/extract`, `/read`, `/extract/batch`, `/lockfile-pin-delta`, and `/commerce/seller-integrity-audit`. `GET /defi/morpho-position` is outside it, so this response has no validation row, retained body, schema verdict, or truncation mark. The route contract can return a position snapshot, set `truncated` above 100 indexed positions, or return HTTP 200 with `ok: false` from its catch. Which of those happened is unknown. The declared caller predicate is unknown. The public aggregate does not retain query keys.

No shared product defect was reproduced as a failing test, so no merchant handler was changed. The 200-on-failure catch matches the existing extract comment that a paid HTTP 200 is not source success. The gap is that morpho has no delivery class for that distinction.

## One experiment

The bottleneck is delivery classification on the route that actually settled, not another extract excerpt and not a new store. 608 morpho challenges in the same window are reach, not the missing fact.

Next unpaid experiment: on one fixture borrower that is not taken from this receipt, run in-process `morphoPosition` and the free Morpho index. Score three outcomes separately: an `ok` snapshot, an HTTP 200 `ok: false` upstream failure, and `truncated: true`. Judge only whether the paid shape changes a liquidation-headroom decision versus the free source. Do not pay, sign, broadcast, or backfill this payer's intent. Do not add the result to recognized revenue.

## Checks

```sh
node experiments/incoming-cash-trace-1005/check.mjs experiments/incoming-cash-trace-1005/EVIDENCE.json
node experiments/incoming-cash-trace-1005/check.mjs experiments/incoming-cash-trace-1005/fixtures/seeded-backfill-extract-delivery.json
```

The first exits 0. The seeded file backfills extract delivery, counts the payout, and books organic revenue. It exits 1 and lists those violations. Node is v22.22.2.
