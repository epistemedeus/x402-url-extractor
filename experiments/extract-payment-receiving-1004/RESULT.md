# Extract payment receiving, 2026-10-04

Status: received. No producer defect was reproduced, so no shared
implementation change. The two `/extract` paid successes are two distinct
canonical USDC settlements by one unclassified payer. They are not recognized
revenue, not the seller settlement, and not the August extract cohort.

## Continuation

Traffic session `0e57e6c7-96a3-4e65-be3a-182428783f7e` is on this VM
(enrollment cloud-f, hostname `cursor`). Its summary matches the traffic job:
cwd, model `grok-4.7`, effort `xhigh`, end `2026-10-04T15:39:39Z`, export
`c3f04b2328cac074e99742cf16b23a4c471bc2ca`. That export is an ancestor of
`e3815c49715421ae8b3e53c8ba5410d4a16ac82a`. The session is terminal and the
new cut is later, so this job continues from the merged export in session
`1cc2c2ac-912f-4a3e-88a2-6e9595c37c1a` instead of forking the finished process.

The exact 44,742-byte response at `2026-10-04T17:16:31.688Z` remains only at
`/home/ubuntu/root-traffic-receiving-1004.uPkVHI/public-demand.json` on
cloud-d. This host has no Railway CLI session and no cross-vm file read.
A later public read at `2026-10-04T17:34:41.039Z` is 44,744 bytes, sha256
`d3514e5a19241bb55d40bbb22fb281dc163a97410710dc8f23959ec2bcfdab7e`. It is not
that admitted file. Its paid-success structure is the same: seller 1, extract
2, unclassified 3, actors 2, repeat 1, distinct settlement references 3,
replays 0.

## What the two observations are

| | extract-a | extract-b | known seller, already in the prior 44 |
| --- | --- | --- | --- |
| Block time | 2026-10-04T14:16:09Z | 2026-10-04T15:30:37Z | 2026-10-04T02:53:13Z |
| Settlement | `0x3e3dee90f56fb88f9f1ec334dd4b78b119ab2a408c8181c273e8e22685d12090` | `0x104467b62ad4edff622eb0f008e9d127b59c75075947ce3962dbf7c4d622887f` | `0x1d9f6315c0c0c2c9c5976dc8fa567ca0bb226e360cd3d3c64814f4d8da176b37` |
| Amount | 5000 (0.005 USDC) | 5000 (0.005 USDC) | 10000 (0.01 USDC) |
| Call | `transferWithAuthorization` `0xe3ee160e`, status success | same | same |
| Chain-from sha256/12 | `f4d5c65ea76d` | `f4d5c65ea76d` | `761193f9b887` |

Both extract times are inside the interval the 17:16 window adds after the
13:00 cut, `(2026-10-04T13:00:47.352Z, 2026-10-04T17:16:31.688Z]`. That is why
they are newly present in the retained projection. They were not created by
the provenance deploy. The durable ledger moved from 44 settlements /
`1037000` to 46 / `1047000`. The only new USDC inflows to the treasury after
the seller settlement are these two 5000-atomic transfers, and the retained
HTTP route for the two new paid successes is `/extract`.

Commerce event ids were not read. Raw payer addresses are not in this export.
The sha256/12 value is a continuity key for the chain `from` address. It is
not the server HMAC `paymentActor`. Same chain `from` still implies the same
server `paymentActor`, because that key is HMAC(secret, `payer:` + lowercased
address).

Replay is false. The hashes differ, the calls are 74 minutes apart, and the
later aggregate has `replaySuccessEvents` 0. Neither hash is the seller
settlement or the August 2026 extract cohort (`41a1a825bcef`).

HTTP event, canonical transfer, and recognized revenue stay separate. These
are retained `paid_success` events and confirmed treasury transfers.
Recognized banked net stays 10.955 USDC. `recognizedRevenueAtomic` on the
seller diagnostic plane is `0`.

## Attribution

Both extract successes are `direct-or-unattributed` and unclassified. Verified
internal paid successes are 0. Self-reported owner-monitor paid successes are
0. The one challenge-to-paid conversion in the later read is
`declared-receipt-referral`, which is the seller success's discovery source,
not the extract pair. An absent internal marker does not prove an outside
buyer. Unclassified means the payer is not on the payment-class allowlist.

No admitted job receipt matches either hash. The traffic job's clock overlaps
the 15:30:37Z transfer and its result says it made no purchase. Its transcript
does not contain either hash. The changed-index and Sol MCP jobs start after
both transfers. Timing is not identity.

The seller chain payer also settled 0.01 USDC on 2026-10-01 and 2026-09-28.
Those are outside this window, so the windowed seller plane stays at one.

## Why repeat is 1 while the seller plane is 1

`repeatPaidSuccessActors` counts external `paid_success` continuity keys whose
count is greater than 1 on every route. The seller transaction plane counts
only `/commerce/seller-integrity-audit`. Two extract payments from one payer
plus one seller payment from another payer produce actors 2, repeat 1, and
seller-plane paid success 1. A changed control with three distinct payers
produces repeat 0. A replay does not add a paid success. An internal-token
payment stays out of the public rare paid numerator and out of
`unattributedExternal`. An allowlist entry is required before the same payer
becomes `independent`. The live cut has independent and repeat-independent
counts of 0, so this payer is not on that list.

Stream and rare full-window coverage are both `unknown_for_full_window`. The
rare rotated file is absent and capture continuity is false. The retained
stream does not start at or before the requested window. These three paid
rows are retained observations, not a 24-hour census, and not a conversion
rate against the 13:00 cut.

## Delivery

GET `/extract` is an owning HTTP-delivery target. The public aggregate does
not include the body, the requested URL, or a validation row. Query values are
not stored on the commerce event. The bytes, if captured, are in the Railway
volume file `http-response-validation.v1.ndjson`. That file was not read.
Usefulness stays unknown. HTTP `paid_success` and a settlement do not fill it in.

## Business implication

What was requested is two paid `GET /extract` calls at the catalog price of
0.005 USDC. What was delivered is not known from retained public evidence.
Why or how it was bought is unknown beyond "same unclassified payer, twice,
74 minutes apart, x402 exact on Base, no internal token, no owner-monitor
user agent, no receipt-referral source." The second settlement does not show
that the first body failed, and it does not show satisfied reuse.

The useful reusable asset is this join plus the confirmed counting split:
unattributed external repeat settlement is visible without being called a
customer. Shared R&D (seller contract, provenance repair, this receiving) is
not a cost of this 0.010 USDC gross. Marginal delivery is two executions of
the already running extract path. Support cost is unknown until a buyer
predicate exists. Paid commission, the Agent402 and What Agents Buy receipts,
owner QA, and this unclassified repeat stay separate.

One next experiment: a read-only join of these two settlement references to
the existing validation rows and commerce event ids on the Railway volume
Root already used for the seller settlement. Record schema result, `sourceOk`,
truncation, and whether a body exists. Do not buy a replacement response. If
the rows are absent, stop at that fact.

## Ledger note for Root

Do not apply it from this branch. Do not add recognized revenue. Do not
increment `extract-unclassified-repeat-settlements-2026-08-26`; that cohort
is a different payer. A separate conditional observation
`extract-unclassified-pair-2026-10-04` can record two settlements,
`unclassifiedSettledUsdc` 0.01, `externalRevenueUsdc` 0, `recognized` false,
`counterpartyControl` unknown. Recognized banked net stays 10.955 USDC.

## Checks

`node --test experiments/extract-payment-receiving-1004/repeat-semantics.test.mjs`
passed 4, failed 0, exit 0.

`node experiments/extract-payment-receiving-1004/admit.mjs experiments/extract-payment-receiving-1004/EVIDENCE.json`
printed `{"accepted":true,"failures":[]}`, exit 0.

`node experiments/extract-payment-receiving-1004/admit.mjs experiments/extract-payment-receiving-1004/seeded-false-revenue.json`
rejected recognized revenue, a census, collapse into the seller and August
payers, a copied seller hash, a backfilled body, an invented event id, and an
outside-buyer claim from a missing marker. Exit 1.
