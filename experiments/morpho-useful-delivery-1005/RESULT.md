# Morpho useful delivery

Status: prospective contract on the existing paid route. The 2026-10-05 receipt stays unclassified. No new paid offer.

Native run: job `ROOT-1005-MORPHO-DELIVERY`, session `9cf6a0c1-0dfb-4d09-879d-85649fb62d63`, hostname `cursor`, model `grok-4.7`, effort `xhigh`. Continues cash-trace session `b5c0a8a2-8814-41b2-b894-398139dd9b55` and draft PR 175 at `a5738d1d`. Merchant source `355c525a6112ad271ac58fe69016a8fb1b1a4dd3`. Pilot tip `9b9af7aa6fb41aa08151e29fb13aca2a68a407ad`.

## What the route already does

`GET /defi/morpho-position` is a read-only Base wallet snapshot. It asks the public Morpho GraphQL index for borrow positions, applies the requested collateral shocks (default `-10,-20,-30`, at most eight), and can cross-check collateral, borrow shares, and oracle price on public Base RPC. `truncated` is true when the index reports more than 100 positions. The HTTP handler still answers upstream throws with HTTP 200 and `{ ok: false, address, error, boundary }`. The MCP tool `morpho_position` calls the same function. A throw becomes MCP `isError` with `{ ok: false, error, charged: false }`. Price default remains `$0.02`. Payment, replay, and signing are unchanged.

## Delivery classes

The owner is `http-delivery-evidence`, bound to `morphoPositionOutputSchema()`. Usefulness on every validation row stays `unknown`.

| Producer outcome | Class | Verdict |
| --- | --- | --- |
| `ok: true` snapshot, count matches, not truncated | `complete_useful` | pass |
| `ok: true`, zero positions, not truncated | `useful_negative` | pass |
| `truncated: true` or a retained prefix of a longer body | `truncated_partial` | pass |
| body is not the success object | `malformed_body` | invalid |
| HTTP 200 or MCP `isError` with `ok: false` | `upstream_failed` | invalid |
| empty body | `missing_body` | unknown |
| success object whose `positionCount` disagrees with `positions` | `unknown` | unknown |
| HTTP status outside 2xx | `merchant_http_failure` | invalid |

A future row attaches only when method, route, event id, and response digest match the paid-success row. A non-null settlement reference or request digest must match too. A conflicting value does not attach. Caller usefulness is `declareCallerUsefulness`: an explicit `caller` disposition bound to the same request, event, and settlement. A delivery class, a model, or an inference does not fill it in.

Event `e87c5642-c177-49bb-809a-05912264d7e3` has no retained body. A caller-supplied digest that was not produced from observed bytes is refused for every event id, so this call stays uncaptured. Buyer predicate and earlier-payer continuity stay unknown.

## Free-index comparison

One non-customer fixture, the same integers as `morpho-position.test.mjs`, shocks `-10` and `-50`. Both sides saw the same GraphQL page. Direct RPC was disabled on both sides. Health factor matched exactly. The free `priceVariationToLiquidationPrice` is the same quantity as the paid percent. The shock table matched local arithmetic on the free collateral, borrow, price, and LLTV integers. New upstream facts: 0. Incremental utility: false. No new paid offer.

## Checks

Node v22.22.2.

```sh
npm run test:http-delivery-evidence
node --test --test-concurrency=1 morpho-position.test.mjs
node --test --test-concurrency=1 commerce-outcome-binding.test.mjs
node experiments/incoming-cash-trace-1005/check.mjs experiments/incoming-cash-trace-1005/EVIDENCE.json
node experiments/incoming-cash-trace-1005/check.mjs experiments/incoming-cash-trace-1005/fixtures/seeded-backfill-extract-delivery.json
node experiments/morpho-useful-delivery-1005/check.mjs experiments/morpho-useful-delivery-1005/EVIDENCE.json
node experiments/morpho-useful-delivery-1005/check.mjs experiments/morpho-useful-delivery-1005/fixtures/seeded-http-200-is-useful.json
```

The http-delivery-evidence suite, morpho-position tests, and outcome-binding tests exited 0. Both evidence checks exited 0. Both seeded files exited 1. The Morpho seeded file lists `http_200_ok_false_counted_useful`, `historical_backfill`, `new_paid_offer`, and `incremental_utility_claimed`.

Pilot-chat was not available in this session. No advice was collected.
