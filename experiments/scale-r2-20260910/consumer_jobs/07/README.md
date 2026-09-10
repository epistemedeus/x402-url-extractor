# R2-CONSUMER-JOBS-07 — Evidence-based procurement brief

Isolated experiment under `experiments/scale-r2-20260910/consumer_jobs/07` in
`epistemedeus/x402-url-extractor`.

## Outcome

Compare **caller-supplied** service contracts against explicit task needs and
real free baselines. Emits a factual procurement brief with **no investment
recommendation**.

## Constraints

- Dry-run only: compare supplied fixtures; **never** fetch live paid offers
- No ranking scores, reputation, buy/sell/invest advice, revenue projections,
  escrow, or custody claims
- Synthetic / public fixtures only
- Feature-branch source/tests only — Root owns merge, publication, and paid actions

## Cost-comparison vocabulary (`reuseFrom: R2-CAPABILITIES-04`)

Capability04 (Cost-aware dry-run comparison) is not finished yet. This package
defines shared vocabulary so Cap04 can align later:

| Concept | Values |
| --- | --- |
| `priceState` | `quoted` · `missing_price` · `external_cost` · `stale_or_untrusted_source` |
| `freeAlternativeState` | `equivalent` · `not_equivalent` · `unavailable` (+ `freeAlternativeBasisId`) |

Keep **`unavailable`** distinct from empty / no-users. Free-baseline states
mirror payment-rail `purchase-intent` `FREE_ALTERNATIVE_STATES`. Price-source /
forbidden-field spirit mirrors capability-market `PRICE_SOURCE` / `FORBIDDEN_FIELDS`.

## Schema

- Input: `x402.r2.consumer.procurement_input.v1`
- Brief: `x402.r2.consumer.procurement_brief.v1`
- Status: `ready` | `partial_input` | `rejected`

## Quick start

See `CONSUMER.md` and `DEMO.md`.

```sh
cd experiments/scale-r2-20260910/consumer_jobs/07
npm test
npm run demo
node src/cli.mjs brief fixtures/positive.json
```

## Mutation boundary

Exact feature-branch source only. Do not merge/publish/pay from this package.
