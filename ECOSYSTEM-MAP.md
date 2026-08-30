# Ecosystem map: provider acceptance versus catalog materialization

## Frozen job

For one exact public x402 route, distinguish a seller eligibility failure from
a provider-accepted route that has not materialized in the provider's buyer
catalog. The output must change the operator's next action without asserting
demand, settlement, or a provider-supported reindex mechanism.

## Evidence and recurrence

SameDayDesk, Atinamos, and an independently operated Thryve route have each
produced the same observable split: Coinbase's endpoint validator accepted the
route while exact-resource Bazaar readback remained absent. This establishes a
repeated operational state across three sellers, not prevalence or willingness
to pay.

## Reuse decision

- Reuse Coinbase's official seller validator as the provider-eligibility view.
- Reuse Coinbase Bazaar search as the provider materialization view.
- Reuse the existing SameDayDesk Agent Discoverability Audit for cross-registry
  rank, route, price, and identity evidence.
- Add one replaceable, source-labeled opt-in adapter. Do not build a validator
  wrapper, a new SKU, a new registry, a poller, or a reindex service.

The residual invariant is the comparison Coinbase's two provider surfaces do
not return themselves: validation acceptance is not catalog materialization.

## Integration and authority boundary

`materializationAudit=true` requires an exact route and an explicit GET or POST
method. The adapter performs one provider validation and one exact-resource
catalog readback, then returns only bounded normalized facts. Provider results
remain provider-returned point-in-time evidence. The audit never promotes them
to settlement, demand, seller trust, independent runtime validity, or reindex
authority. Adapter unavailability leaves the cross-registry audit intact.

## Hostile acceptance cases

1. Accepted validator plus absent exact resource becomes
   `provider_accepted_not_materialized`.
2. Rejected validator plus absent exact resource becomes
   `seller_not_provider_eligible`.
3. Exact-resource readback becomes `materialized` even if the current validator
   later rejects.
4. Missing or malformed provider evidence becomes `unresolved`; it never
   becomes accepted, rejected, or materialized by default.

## Adoption and kill conditions

Continue only if an independent seller or operator reports that the distinction
changed a repair or escalation action, or if the existing paid audit receives
independent use. Remove the adapter if Coinbase publishes authoritative
ingestion disposition or supported reindex state through one official surface,
or if the adapter creates no external use after the bounded experiment.
