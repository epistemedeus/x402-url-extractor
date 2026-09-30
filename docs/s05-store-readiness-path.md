# S05 store-readiness path note

Merchant-side note only. The S05 integrate job owns the Pilot tree write. This file does not update Pilot, does not open a revenue platform, and does not change a price or SKU.

## Source

Pilot pull 238 at `35a1075cb274d84a716a656d13914548243765bd`. The unpaid check on that pass was Coinbase x402 discovery search `query=seller integrity audit`, `urlSubstring=samedaydesk.com`, `limit=5`.

Facts carried from that pass for the seller-integrity route:

- Resource `https://agents.samedaydesk.com/commerce/seller-integrity-audit`
- Catalog amount `10000` atomic Base USDC. That is the listed price, not a balance.
- `quality.l30DaysTotalCalls` 3
- `quality.l30DaysUniquePayers` 3
- `quality.lastCalledAt` `2026-09-28T06:02:21.396Z`
- `partialResults` false, one resource, description length 469, no `featured` field
- Label on that pass: `catalog-aggregate-unverified`

The same counters are what `seller-integrity-event-reconcile.mjs` reads. A later live read can diverge. Divergence still does not become revenue.

## Attribution

The three payers are not identified. Attributable for this catalog row is `unknown`. It is not `external` and it is not `owner_qa`. Wallet classes from `COMMERCE_PAYER_CLASSES` do not join to Bazaar quality counts. A settlement-ledger class label stays on the ledger row.

R02 left this question open: whether those three payers are external. This reconcile does not close it.

## Revenue

Catalog calls, unique payers, and `lastCalledAt` are not catalog revenue and are not banked. A settlement ledger that happens to show the same count is not those three calls. An empty or zero ledger is not a historical zero.

R02 left its carried banked net unchanged and did not add this row. This note does not restate or recompute that net, and it does not add three catalog calls to it. `bankedRevenueInvented` stays false.

## Next owner

S05, for the Pilot store of pull 238. No claim, no spend, and no product change from this note.
