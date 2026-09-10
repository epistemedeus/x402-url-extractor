# Buyer acquisition interface — exact partial compose (S159)

Crisp operator path to surface per-recipe acquisition decisions **without**
reading the frozen packet end-to-end. Schema:
`x402.r2.consumer.acquisition_status.v1`.

## What this is

- A **status** CLI over the last journey JSON (or an explicit `--journey` /
  `--package` path).
- Machine JSON + human table: `recipe id`, `jobRef`, `slotStatus`,
  `heavyDecision`, `packageStatus`.
- **Partial is success for this tool** (exit 0): acquisition may proceed with
  eyes open. Rejected / missing / invalid input → non-zero.
- Does **not** spawn Heavy analyze, invent pass, or “fix” 03/04/05.

## What this is not

- Not a ready-package claim.
- Not an investment, revenue, ranking, escrow, or custody recommendation.
- Not a Heavy CLI fix (table-reconcile / link-index / replay-pack fail and
  release-brief conflict mis-report remain **external defects** for Heavy parent).

## Operator steps

```sh
cd experiments/scale-r2-20260910/consumer_jobs/compose

# Optional: refresh journey artifacts (may spawn Heavy; not required for status tests)
npm run journey

# Acquisition status (reads journey JSON only)
node src/cli.mjs status
node src/cli.mjs status --journey ../08/demo-out/s152/journey.json
node src/cli.mjs status --journey fixtures/partial-journey.json --json
node src/cli.mjs status --package fixtures/rejected-package.json --json
```

Default search order when no `--journey` / `--package`:

1. `../08/demo-out/s152/journey.json`
2. `demo-out/s152/journey.json`
3. `../08/demo-out/journey.json`
4. `demo-out/journey.json`

## Exit codes

| Condition | Exit |
|---|---|
| `packageStatus` ready or **partial** | **0** (acquisitionOk) |
| `packageStatus` rejected | 1 |
| Missing journey/package file | 1 |
| Invalid JSON / shape | 1 |
| Usage / unknown command | 2 |

## Exact partial matrix (S152 positive integrated journey)

| id | jobRef | slotStatus | heavyDecision |
|---|---|---|---|
| migration-checklist | R2-CONSUMER-JOBS-01 | ready | pass |
| release-brief | R2-CONSUMER-JOBS-02 | ready | pass |
| table-reconcile | R2-CONSUMER-JOBS-03 | failed | fail |
| link-index | R2-CONSUMER-JOBS-04 | failed | fail |
| replay-pack | R2-CONSUMER-JOBS-05 | failed | fail |
| freshness-receipt | R2-CONSUMER-JOBS-06 | ready | pass |
| procurement-brief | R2-CONSUMER-JOBS-07 | ready | — |

Known external Heavy limitations (documented, not fixed here):

1. CLI `analyze` on synthetic positives for **table-reconcile / link-index /
   replay-pack** returns **fail** (compose records real fail).
2. Some **release-brief** conflict fixtures via CLI return **pass** instead of
   conflict (deferred to Heavy).

## Example machine output (shape)

```json
{
  "schema": "x402.r2.consumer.acquisition_status.v1",
  "packageStatus": "partial",
  "acquisitionOk": true,
  "recipes": [
    { "id": "migration-checklist", "jobRef": "R2-CONSUMER-JOBS-01", "slotStatus": "ready", "heavyDecision": "pass" },
    { "id": "table-reconcile", "jobRef": "R2-CONSUMER-JOBS-03", "slotStatus": "failed", "heavyDecision": "fail" }
  ],
  "summary": {
    "failHeavy": ["table-reconcile", "link-index", "replay-pack"]
  },
  "hasInvestmentRecommendation": false
}
```

## Forbidden claims

No investment recommendation, revenue projection, ranking, escrow, custody, or
“package ready for paid acquisition” language. Fixture URLs remain data.
