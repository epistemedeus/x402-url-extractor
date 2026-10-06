# Aggregate settlement-route attribution, 2026-10-06

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
- Aggregate consistency: rolling `/extract` `paid_success` count moved 0 to 1 and its ledger count moved by 1. This does not directly join an individual request to the new settlement. Exact event ID, timestamp, reference and body are absent.
- Caller: `direct-or-unattributed`, population `unattributedExternal`. Verified-internal, owner-monitor, scanner, and crawler paid successes are 0. The window has 2 paid-success actors and 1 repeat across 3 successes, with no actor-to-route binding. No customer identity. `independentPaidSuccessActors` is 0. A missing owner marker is not an outside buyer.
- Delivery: no validation row, digest, schema verdict, or body in this receipt. Sufficiency unknown. Acceptance unknown. `buyerValidDeliveryCount` is null. The October 4 extract `truncated_partial` pair is not copied.

### 2. `/defi/morpho-position` — 20000 atomic / 0.020 USDC — 2026-10-06 — remain unclassified

- Settlement reference: not in either receipt. Not `0x2439870db33f6e81157beffed44c26b02aad663aff595424929ac04f9030008d`.
- That prior reference is the already classified 2026-10-05T06:01:39Z row inside both windows. It is not recounted. The current ledger has one new Morpho settlement and its rolling paid-success count moves 1 to 2; this is aggregate consistency, not a directly observed individual request join.
- Caller: same population boundary as the extract row. No actor is bound to this settlement.
- Delivery: no captured validation row in this receipt. Sufficiency unknown. Acceptance unknown. The 2026-10-05 uncaptured Morpho body is not copied. Rare-funnel coverage is `unknown_for_full_window`, so that store is not the delivery record.

`/schemaforge` and `/read` credential attempts in the current window are not these settlements. They did not move the ledger.

## Repair

No handler defect is established by these receipts. Attribution is incomplete: route-ledger deltas and matching rolling request counts do not identify an individual event-to-settlement relation. Root corrected the unsupported `ordinaryRequestJoined:true` assertion. Both amounts remain unclassified, with unknown output sufficiency, acceptance and usefulness. Complete the existing authorized private producer join and ordinary future delivery capture; do not infer a buyer, publish private bodies or create a second ledger.

## Checks

```sh
node experiments/settlement-join-1006/join.mjs --self-test
node experiments/settlement-join-1006/join.mjs --check-live
node experiments/settlement-join-1006/check.mjs experiments/settlement-join-1006/EVIDENCE.json
node experiments/settlement-join-1006/check.mjs experiments/settlement-join-1006/fixtures/seeded-invented-reference.json
```

The builder's pre-amendment first three commands exited 0, and its seeded file exited 1. Those tests incorrectly pinned the aggregate inference as a direct request join. Root's amendment adds single-defect controls for that overclaim, a hidden attribution gap and malformed rows. Independent cloud-d receiving at 2026-10-06T05:38:56.470–05:38:56.639Z passes all eight unit checks, same-receipt live reconstruction, self-test and positive evidence; the existing seeded invalid evidence exits 1. The exact tested source is48621a76fbcf49738ecfc75eb70ce38df8d7bffe and stays unchanged. Receipts are in /home/ubuntu/root-settlement-receiving1006.

```sh
node --test experiments/settlement-join-1006/check.test.mjs
```
