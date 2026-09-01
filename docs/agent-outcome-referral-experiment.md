# Receipt-bound agent referral experiment

Status: Stage 2 bounded executable experiment, not a referral network or demand claim.

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
| [x402 signed offers and receipts](https://docs.x402.org/extensions/offer-receipt) and Apache-2.0 `@x402/extensions@2.16.0` | `enrichSettlementResponse` issues a seller-signed receipt when settlement succeeds, binding the resource, payer, network, issue time, and optional transaction | Reuse as settlement-receipt evidence. Derive a non-secret ID with the package's RFC 8785 canonicalization and SHA-256 semantics. |
| [A2A Agent Card and extensions](https://github.com/a2aproject/A2A/blob/main/docs/specification.md) | Machine-readable capability discovery and optional extension declarations | Keep as a later advertisement surface. It does not prove settlement, output validity, or a referral. |
| [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | Neutral identity, reputation, and validation registries | Revisit only if separate buyer-owned validation evidence exists. Do not publish feedback from receipts alone. |
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
- one free changed-state recheck is earned only when a downstream settlement
  receipt identifies a distinct payer and distinct transaction on the same network;
- the seller-signed receipts prove successful settlement at receipt issuance,
  not an application HTTP 200 response, output delivery, or buyer-owned output validity.

The traffic writer records only the controlled `declared-receipt-referral` source label
and the presence of the query key. It does not retain the digest, signed
receipt, payer address, prompt, or arbitrary query value. The label means only
that a syntactically valid ID was declared.

`POST /commerce/referral-recheck` is free and outside the payment and demand
classifiers. Its JSON body contains exactly `original` and `downstream` signed
receipts. Both must be complete merchant-signed EIP-712 receipts with signed
transaction hashes. The original signed URL must be the canonical
Seller Integrity Audit route and may omit `referral` or contain one valid prior
referral. The downstream signed URL must carry exactly the new referral derived
from the complete original receipt. The server reruns only the target encoded
in the original signed URL, with any prior referral stripped from the free
audit input so the recheck creates no paid attribution event and echoes no
ancestor referral.

After the recheck completes, the server atomically creates one empty mode-0600
marker named by the referral ID in the private commerce data directory. No raw
receipt, payer, transaction hash, wallet address, or request body is retained.
If execution throws before that point, no marker exists and the reward can be
retried. The marker is the consumption point immediately before the successful
response, so a process failure after marker creation can consume a completed
recheck even if its response is interrupted.

## Smallest live test

1. Publish one factual field note with the public first-customer evidence and
   exact paid audit URL.
2. Let the prior customer or another satisfied buyer share its own
   receipt-derived ID on an agent-native surface.
3. Observe the existing source funnel for a `declared-receipt-referral` challenge and
   paid success. These observations remain acquisition evidence, not receipt verification.
4. Submit both complete signed receipts to the free claim endpoint. At most one
   successful changed-state recheck is returned for the referral ID.

No automatic credit balance, payout, referral ledger, new identity protocol,
or generic agent social network is admitted by this experiment.

## Agent402 signed-receipt artifact compatibility

Agent402 PR 1070 (merge `f6f2595d202b9224fd70bc090a3b0330f8b19852`; upstream
`scripts/lib/smoke-receipt.js` SHA-256
`90841bd10f4176eff8b838d953d56836d2c6b4bef6a0537c654314b86feba268`; AGPL-3.0)
captures a complete bare seller-signed offer receipt as mode-0600 pretty JSON
with a trailing newline and no outer wrapper. SameDayDesk already hashes that
complete envelope with RFC 8785 JSON Canonicalization plus SHA-256
(`r1_<digest>`) and accepts the parsed object on `POST /commerce/referral-recheck`.
Ordinary `JSON.parse` of a file matching that observable contract is enough.
This repository does not bundle Agent402 source or take an Agent402 runtime
dependency; `fixtures/agent402-pr1070/` retains only factual provenance, and
`agent402-receipt-interop.test.mjs` replays the contract with an independently
authored helper.

## Scale and stop conditions

Scale only after one independently controlled referral-attributed settlement,
plus separate buyer-owned output-validity evidence if any validity claim is to
be made, followed by either a second such buyer or one external operator
requesting the mechanism. If 30 days and at least 200 non-owner audit reach observations pass with
zero referral-attributed challenge, keep the code dormant and do not build the
larger network.
