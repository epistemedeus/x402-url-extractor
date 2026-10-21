# Credential cutover receiving

ROOT2462, synthetic source qualification on product base
`77b023cb4fc2a00e3c5c05f594daba66fb033ca8`. This is not installed rotation,
issuer recovery, release approval, or evidence of outside use.

## Restoration matrix

| Authority / actual consumer | Replacement behavior | Preserved history / limit |
| --- | --- | --- |
| `COMMERCE_INTERNAL_TOKEN`: owner reports, outcome/task bindings, three internal gateway handlers | Current generation only; old owner requests refuse, old gateway requests encounter the ordinary payment gate | Old task refs and causal seals are generation scoped. No old-token grace list. Merchant and Solana gateway must receive the same pending token, with the gateway injecting it only after its own payment gate. Gateway deployment code is outside this repository; its injection is a live receiving requirement. |
| `RECEIPT_SIGNING_PRIVATE_KEY`: `commerce-trust.mjs`, x402 extension, HTTP referral recheck | New EIP-712 offers/receipts verify under the new public signer/kid | Existing envelopes/kids are never rewritten. Configure comma-separated **public addresses** in `RECEIPT_RETIRED_SIGNERS` to classify retired proofs as HTTP 503 `historical_receipt_verification_unavailable`. This metadata grants no trust and stores no old private key. Foreign signers still refuse 403. |
| Existing `referral-recheck-claims` markers | A retained original receipt hash returns 409 before historical signature recovery; atomic creation remains the consumption authority | Markers remain empty, private, and unchanged across restart. Unconsumed old obligations remain unresolved; they are neither invalidated nor reopened. New claims still verify both current signatures, target/network/payers/transactions/order and consume only after the recheck. |
| Internal-token HMAC coverage cuts | Old generation fails authentication; current generation starts a fresh finite baseline via POST `/v0/ordinary-delivery-join.json`, then GET readback | Recognized unverified cut metadata is counted separately from broken event rows. It proves no coverage or observation time; tampering and rotation are indistinguishable. Retained journal bytes survive. Source/namespace changes also withhold old authority. Missing producers remain unknown; overall coverage remains partial and non-exhaustive. |
| `CALLER_RESULT_FEEDBACK_KEY`: HTTP feedback and MCP `report_caller_result` | New capabilities succeed against existing exact capture bindings; old capabilities refuse | Retained caller statements survive without being re-signed. Same-statement replay stays idempotent; usefulness remains unknown. Feedback creates no payment, settlement, or revenue event. Missing captures are unavailable; key possession alone does not create them. |
| `COMMERCE_ACTOR_SECRET`: HTTP/free-result pseudonyms, payer classes, MCP attribution | New events carry a domain-separated HMAC `actorEpoch`; restart with the same key preserves it | Old rows without an epoch stay legacy/unknown. Aggregate actor counts are opaque pseudonym counts, never people, new users, or revenue. `actorContinuity` exposes this scope and null people/new-user counts. No caller contents, cross-epoch linkage, or second ledger is added. Old payer pseudonyms cannot be reclassified from the new key. |
| Same actor secret: existing durable HTTP/MCP replay store | Existing store gains a purpose-specific `keyEpoch`. Active mismatched or pre-epoch rows quarantine replay instead of becoming cache misses | No active marker is deleted or adopted. HTTP returns 503 `replay_key_generation_unavailable` before payment verification/settlement; native recovery returns its existing storage-unavailable refusal. Existing expiry permits a fresh generation after all active rows drain. Completed results and possible-spend state remain retained during unavailability. |
| Settlement reconciler / canonical financial rows | Already recorded settlement references are skipped before a new actor-key comparison or chain call | Recorded amounts/classes/terms survive. Unreconciled old events may lose payer-continuity verification; leave them unresolved rather than synthesizing new settlement/revenue. |

The same conservative retirement boundary applies to routine replacement and a
potentially exposed signer. An old-key signature alone cannot distinguish genuine
issuance from a freshly forged/backdated receipt. Paid-success captures do bind a
request digest and settlement reference; settlement rows bind economic facts.
Neither store retains the complete issued receipt, its issuance time, or its
receipt-derived referral identity. A chain transfer alone does not establish the
HTTP resource. No receipt archive or historical entitlement ledger is invented.
Root must separately receive trustworthy historical evidence before resolving an
unconsumed old-proof obligation. Unaffected unsigned offers, free HTTP/MCP tools,
owner reporting, current feedback, and current referral claims remain independent.
Paid execution is additionally unavailable while an active replay store has an
unreceived generation; do not delete it to make readiness green.

`MPP_SECRET_KEY` remains the existing challenge authority. Old pending challenges
must not acquire a secret grace list. Cached paid responses keep their original
receipt bytes; only newly issued artifacts are expected to use the new signer.

## Executable receiving and prior observations

Run `npm run test:credential-cutover` (serial Node; synthetic keys, temporary
stores, loopback facilitator; no real wallet/payment/provider mutation). The
merchant-process test exercises actual owner/gateway/offer/referral/HTTP feedback
and native MCP feedback wiring through restart, and checks that feedback adds no
paid-success rows and makes zero facilitator verify/settle calls.

Before correction, seven cutover tests produced three passes and four failures:
retired proofs and consumed old claims both returned `foreign_receipt_signer`;
old HMAC cuts yielded `unusable_records_present`; no actor epoch existed.
A separate prior-source replay control failed with **Missing expected rejection**:
the same reserved payment became a new reservation under the replacement actor
key. These failures are retained in the receiving export, not rewritten as passes.
Existing baseline controls passed 75/75. Broader verification commands and exact
counts belong to the final receiving receipt.

## Root's one-shot live readbacks

After issuer revocation and trusted provider recovery, receive:

1. Exact source/tree, installed deployment identity, persistent volume identity,
   and unchanged financial/claim-marker state. Match all actual consumers to the
   single pending generation without publishing values. Read replay readiness
   and existing expiry; preserve any active historical quarantine.
2. Current owner HTTP success and old-owner refusal; the gateway's actual
   post-payment injection uses that same current token. Source tests do not
   establish that the separate stopped gateway was updated.
3. New unsigned paid challenge's signature/signer/kid; next authorized ordinary
   HTTP/MCP delivery's receipt verifies under the new signer. Do not create a
   second payment merely to obtain evidence. Preserve old cached receipts.
4. Consumed old referral remains 409; unconsumed retired/forged old proof remains
   503 without a marker or charge; a current proof can consume once. Record the
   unresolved old obligation for evidence-based recovery without repricing.
5. Fresh POST coverage baseline then bounded GET/CLI readback: current runtime,
   appends/retained rows, exact partial/unknown planes, no old-cut promotion.
   Historical failure is authentication/source unavailability, not journal loss.
6. Current HTTP/MCP feedback acceptance, old capability refusal, retained statement
   replay and unchanged paid/settlement totals; actor epoch and legacy count have
   explicit scope and establish no acquisition or revenue.

No credentials, issuer actions, deployment, default-branch changes, provider
contact, dependency upgrades, or production/private data are part of this package.
