# Ecosystem map: validator eligibility versus one task-search window

## Current contract

The opt-in Coinbase check keeps two planes apart. Validator eligibility is
whatever the current seller validator returns. The catalog read is one
supported task-search window using the maintained SDK parameters. A missing
exact target in that window is unknown catalog presence for the query. It does
not prove the route is unlisted and it does not support a reindex action.

Response version 1.12.0 withdraws `provider_accepted_not_materialized` and the
reindex action. `seller_not_provider_eligible` is no longer a combined catalog
state. The price stays 0.05 USDC.

## Earlier observation

SameDayDesk, Atinamos, and an independently operated Thryve route each showed
a validator result that accepted the route while one Bazaar read did not
contain that exact resource. That was a repeated split across three sellers,
not prevalence and not proof of catalog absence. The withdrawn classifier
treated that split as non-materialization. A limited query cannot close that
question.

## Reuse decision

- Reuse Coinbase's official seller validator as the eligibility plane.
- Reuse one supported CDP discovery search as the query window.
- Reuse the existing SameDayDesk Agent Discoverability Audit for cross-registry
  rank, route, price, and identity evidence.
- Reuse task-discoverability 0.3.0 for coverage and request construction.
- Do not build a validator wrapper, a new SKU, a new registry, a poller, or a
  reindex service.

## Hostile cases

1. A validator result that reports eligibility, plus no exact row in the
   inspected window, stays `query_window_catalog_presence_unknown`. There is
   no reindex action.
2. A validator result that does not report eligibility is
   `provider_reported_not_eligible` on the validator plane. Catalog presence
   stays unknown unless an exact row was inspected.
3. An exact resource string in the inspected rows is
   `observed_in_query_window` even when the validator does not report
   eligibility. Catalog membership beyond those rows stays unknown.
4. Missing or malformed provider evidence stays `unresolved`. It does not
   become eligibility, observation, or absence by default.
