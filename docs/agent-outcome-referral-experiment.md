# Receipt-bound agent referral experiment

Status: Stage 2 bounded live experiment, not a referral network or demand claim.

## Failed job and first evidence

SameDayDesk's first attributable external runtime customer paid 0.01 USDC for
the Seller Integrity Audit, received a useful `repair_required` result, and the
maintainer changed the seller implementation. The missing next step is a
machine-readable way for that useful outcome to lead another agent to the same
job without requiring a promotional post before purchase or treating a wallet
inflow as customer proof.

## Existing components and reuse decision

| Component | What it already solves | Decision |
| --- | --- | --- |
| [x402 signed offers and receipts](https://docs.x402.org/extensions/offer-receipt) and Apache-2.0 `@x402/extensions@2.16.0` | Seller-signed receipt binds the paid resource, payer, network, issue time, and optional transaction | Reuse as the referrer proof. Derive a non-secret ID with the package's RFC 8785 canonicalization and SHA-256 semantics. |
| [A2A Agent Card and extensions](https://github.com/a2aproject/A2A/blob/main/docs/specification.md) | Machine-readable capability discovery and optional extension declarations | Keep as a later advertisement surface. It does not prove settlement, valid delivery, or a referral. |
| [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | Neutral identity, reputation, and validation registries | Revisit only after the experiment produces real buyer-valid outcomes. Do not publish feedback from settlement alone. |
| [Moltbook](https://github.com/Moltbook-Official/moltbook/blob/main/skill.md) | Current agent-to-agent posts, comments, communities, and semantic search | Use as one distribution channel after account claim. It is not a protocol dependency. |
| Existing SameDayDesk source funnel | Privacy-safe controlled source labels across challenge and paid-success stages | Extend with `declared-receipt-referral`; retain no raw referral digest and do not treat syntax as proof. |

## Executable residual

`GET /commerce/seller-integrity-audit` accepts an optional
`referral=r1_<64 lowercase hex>` value. The value is the SHA-256 digest of the
RFC 8785 canonical JSON for one complete seller-signed x402 receipt envelope.
The handler returns a compact `referralOffer` that says:

- a broadcast is optional, never a condition of the 0.01-USDC price;
- the referral affects attribution only, not payment, authorization, delivery,
  customer classification, or audit output;
- one free changed-state recheck is earned only after a distinct downstream
  payer settles and reports a passing buyer-owned output check;
- the seller-signed receipt proves settlement evidence, not buyer validation.

The traffic writer records only the controlled `declared-receipt-referral` source label
and the presence of the query key. It does not retain the digest, signed
receipt, payer address, prompt, or arbitrary query value. The label means only
that a syntactically valid ID was declared. A reward still requires the full
signed receipt and all downstream qualification evidence.

## Smallest live test

1. Publish one factual field note with the public first-customer evidence and
   exact paid audit URL.
2. Let the prior customer or another satisfied buyer share its own
   receipt-derived ID on an agent-native surface.
3. Observe the existing source funnel for a `declared-receipt-referral` challenge, paid
   success, distinct payer classification, and buyer-owned validation report.
4. Fulfill at most one free changed-state recheck manually during this phase.

No automatic credit balance, payout, referral ledger, new identity protocol,
or generic agent social network is admitted by this experiment.

## Scale and stop conditions

Scale only after one independently controlled referral-attributed settlement
also has buyer-valid delivery, followed by either a second such buyer or one
external operator requesting the mechanism. Until then, keep fulfillment
manual. If 30 days and at least 200 non-owner audit reach observations pass with
zero referral-attributed challenge, keep the code dormant and do not build the
larger network.
