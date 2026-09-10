# Fresh-consumer instructions — S152 compose / S159 acquisition

Literal steps for a new consumer on the compose surface. No paid network calls.
Synthetic fixtures only. Fixture URLs/commands stay **data** (never auto-fetched).

## 1. Enter compose

```sh
cd experiments/scale-r2-20260910/consumer_jobs/compose
```

Requires Node ≥ 20. Zero dependencies.

## 2. Confirm wiring

```sh
ls ../07/src/cli.mjs
ls ../08/src/cli.mjs
ls ../../../s137-consumer-evidence-jobs/scripts/cli.mjs
ls src/cli.mjs
```

Heavy pin: `fa6878de125cfdcfd77f4b47037c88667090d293` (`RESOLVED-INPUT-COMMIT.txt`).

## 3. Focused tests

```sh
npm test
# status-only (no Heavy spawn):
npm run test:status
```

Do **not** cite or re-run Heavy’s full 126 suite from this surface.

## 4. Journey (08) then acquisition status

```sh
npm run journey
node src/cli.mjs status --journey ../08/demo-out/s152/journey.json
# or after journey writes compose demo-out:
node src/cli.mjs status
```

## Exact partial matrix (positive integrated journey)

Package status: **`partial`** (not ready).

| id | jobRef | slotStatus | heavyDecision |
|---|---|---|---|
| migration-checklist | R2-CONSUMER-JOBS-01 | ready | pass |
| release-brief | R2-CONSUMER-JOBS-02 | ready | pass |
| table-reconcile | R2-CONSUMER-JOBS-03 | failed | fail |
| link-index | R2-CONSUMER-JOBS-04 | failed | fail |
| replay-pack | R2-CONSUMER-JOBS-05 | failed | fail |
| freshness-receipt | R2-CONSUMER-JOBS-06 | ready | pass |
| procurement-brief | R2-CONSUMER-JOBS-07 | ready | — |

Fail slots are **external Heavy CLI defects**. They are not
`unavailable_pending_heavy`. Do not invent Heavy pass. Do not claim a ready
package. No investment / revenue / ranking / escrow / custody claims.

## Next

Operator-facing acquisition steps: `ACQUISITION.md`.  
Frozen evidence packet: `FROZEN-E2E-PACKET-S152.md`.
