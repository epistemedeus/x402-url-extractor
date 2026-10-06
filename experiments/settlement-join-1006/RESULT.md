# Settlement join, 2026-10-06

Status: two new unclassified settlements. Transaction strings and captured bodies are not in the authorized receipt. No handler change.

Merchant source `91e14dce308c9d049d6422a4a6570919db46875a`. Pilot main head recorded at admit `5f9f50de08181d7980b2adca1ffdb7a946e4bda2` (not verified in this checkout). Cash 0. Canonical settlement owner `reconcileCommerceSettlementEvents` unchanged. Classification owner unchanged: unknown or missing payer identity remains unclassified. Internal 12 / 0.577 USDC and validation 1 / 0.010 USDC did not move.

## Sources

| Receipt | generatedAt | sha256 | ledger |
| --- | --- | --- | --- |
| Current demand `public-demand.json` | 2026-10-06T04:53:48.437Z | `018bf04ba87c9a87d7e84ff8e430ce0dc61a4755c6b1ea134a69db78b3695469` | 49 / 1092000 |
| Current `RECEIVING.json` | received 2026-10-06T04:53:48.650Z | `026ba0a74d7fc726f183885abd740c0263023d093e229d0b1cfbcb4006aefa1d` | HTTP 200, 45388 bytes, `owner_monitor_readback`, cash 0 |
| Received 47-cut demand | 2026-10-06T00:17:10.607Z | `932830c475c0ef2c7a00b1b39c14c3b28275f46eb124702b35c8b7eb69bbe619` | 47 / 1067000 |
| Received-cut `RECEIVING.json` | — | `baa841d0349337e6e0937f802da94d1899d47292913cb70d3989a65b170c6de6` | HTTP 200, cash 0, `https://agents.samedaydesk.com/v0/commerce-demand.json?days=1` |

The current receiving record does not repeat the URL. The body is the commerce-demand document those hashes name. No second fetch and no chain census were run.

## Decisions

Both stream windows report `requestedWindowCoverage: complete`. The only ledger movements are unclassified +2 / +25000 atomic. Route movements are `/extract` 20/190000 to 21/195000 and `/defi/morpho-position` 7/140000 to 8/160000. `missingSettlementReferencePaidSuccesses` is 0. `reconciledThisRun` is 0 and `issueCount` is 0, so both rows were already canonical before this read. The scan's eligible references moved 3 to 5 and does not name them.

### 1. `/extract` — 5000 atomic / 0.005 USDC — 2026-10-06 — remain unclassified

- Settlement reference: not in either receipt. `settlementEvidencePolicy` keeps raw transaction references private. Reference stays null.
- Ordinary request: the complete one-day `paid_success` count for `/extract` moved 0 to 1, matching the ledger delta of 1. Protocol `x402`. Event id and exact time are absent. The row is inside the current window and absent from the prior window.
- Caller: `direct-or-unattributed`, population `unattributedExternal`. Verified-internal, owner-monitor, scanner, and crawler paid successes are 0. The window has 2 paid-success actors and 1 repeat across 3 successes, with no actor-to-route binding. No customer identity. `independentPaidSuccessActors` is 0. A missing owner marker is not an outside buyer.
- Delivery: no validation row, digest, schema verdict, or body in this receipt. Sufficiency unknown. Acceptance unknown. `buyerValidDeliveryCount` is null. The October 4 extract `truncated_partial` pair is not copied.

### 2. `/defi/morpho-position` — 20000 atomic / 0.020 USDC — 2026-10-06 — remain unclassified

- Settlement reference: not in either receipt. Not `0x2439870db33f6e81157beffed44c26b02aad663aff595424929ac04f9030008d`.
- That prior reference is the already classified 2026-10-05T06:01:39Z row. It sits inside both complete windows, and the prior window has exactly one Morpho `paid_success`, so it accounts for that one. The current window has two. The second is this new ledger row.
- Ordinary request: `paid_success`, `x402`, ledger delta 1. Event id and exact time are absent.
- Caller: same population boundary as the extract row. No actor is bound to this settlement.
- Delivery: no captured validation row in this receipt. Sufficiency unknown. Acceptance unknown. The 2026-10-05 uncaptured Morpho body is not copied. Rare-funnel coverage is `unknown_for_full_window`, so that store is not the delivery record.

`/schemaforge` and `/read` credential attempts in the current window are not these settlements. They did not move the ledger.

## Repair

None. The receipt already joins each new amount to one route and to one new `paid_success`. The classification owner already returns unclassified when the payer is missing. A public hash export, a body backfill, or a new telemetry ledger would go past this receipt.

## Checks

```sh
node experiments/settlement-join-1006/join.mjs --self-test
node experiments/settlement-join-1006/join.mjs --check-live
node experiments/settlement-join-1006/check.mjs experiments/settlement-join-1006/EVIDENCE.json
node experiments/settlement-join-1006/check.mjs experiments/settlement-join-1006/fixtures/seeded-invented-reference.json
```

The first three exit 0. The seeded file invents a hash, recounts the October 5 Morpho reference as extract, moves internal and validation, backfills usefulness, and names a buyer. It exits 1.
