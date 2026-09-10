# First useful result — green recipes only (S159)

Literal buyer/operator path to a **truthful first result** using only confirmed
pass/ready slots from the S152 positive partial matrix. Schema:
`x402.r2.consumer.first_result_offer.v1`.

Package note is **`partial_first_result`** (limited path). This is **not** a
full ready package claim.

## Offered (green)

| id | jobRef | slotStatus | heavyDecision |
|---|---|---|---|
| migration-checklist | R2-CONSUMER-JOBS-01 | ready | pass |
| release-brief | R2-CONSUMER-JOBS-02 | ready | pass |
| freshness-receipt | R2-CONSUMER-JOBS-06 | ready | pass |
| procurement-brief | R2-CONSUMER-JOBS-07 | ready | — |

## Deferred — external Heavy CLI defects (NOT offered)

| id | jobRef | slotStatus | heavyDecision | classification |
|---|---|---|---|---|
| table-reconcile | R2-CONSUMER-JOBS-03 | failed | fail | external Heavy CLI analyze fail |
| link-index | R2-CONSUMER-JOBS-04 | failed | fail | external Heavy CLI analyze fail |
| replay-pack | R2-CONSUMER-JOBS-05 | failed | fail | external Heavy CLI analyze fail |

These are **not** `unavailable_pending_heavy`. Do not invent Heavy pass. Do not
ask this surface to “fix” 03/04/05. Deferred to Heavy parent.

Also documented (still offered for positive path): some release-brief **conflict**
fixtures via CLI return pass instead of conflict — external defect deferred to
Heavy; positive release-brief remains green.

## Operator steps (first useful result)

```sh
cd experiments/scale-r2-20260910/consumer_jobs/compose

# 1) See the truthful offer (dry; no Heavy spawn)
node src/cli.mjs first-result --json
node src/cli.mjs first-result --table

# 2) Optional: dry-assemble offline command plan for green ids only
node src/cli.mjs first-result --plan --json

# 3) Run a single green recipe via sibling CLIs (examples; fixtures stay data)
#    Procurement brief (native 07, offline):
node ../07/src/cli.mjs brief ../08/fixtures/positive.json

#    Heavy green analyze (requires S137 pin + operator clock; do not invent):
# node ../../../s137-consumer-evidence-jobs/scripts/cli.mjs analyze migration-checklist \
#   --in ../../../s137-consumer-evidence-jobs/fixtures/synthetic/migration/cases/positive-complete.json \
#   --clock 2026-09-10T18:00:00.000Z

# 4) Confirm acquisition status still shows exact partial matrix if you have a journey
node src/cli.mjs status --journey fixtures/partial-journey.json --json
```

## Refuse deferred ids

```sh
# Must exit non-zero with deferred_recipe_refused
node src/cli.mjs first-result --recipe table-reconcile --json
node src/cli.mjs first-result --recipe link-index --json
node src/cli.mjs first-result --recipe replay-pack --json
```

## Exit codes

| Condition | Exit |
|---|---|
| Green offer / plan built | **0** |
| Deferred recipe requested | 1 (`deferred_recipe_refused`) |
| Unknown recipe id | 1 |
| Usage / unknown command | 2 |

## Forbidden claims

No investment recommendation, revenue projection, ranking, escrow, custody, or
“full package ready for paid acquisition” language. Fixture URLs remain data.
Do not re-run Heavy 03/04/05 to force a pass on this lane.

## Executed green bundle

To **run** the four green recipes offline and package packets + `bundle.json`
under `demo-out/green-bundle/`, see **`GREEN-BUNDLE.md`**:

```sh
node src/cli.mjs green-bundle --json
node src/cli.mjs first-result --execute --json
```

Schema: `x402.r2.consumer.green_first_result_bundle.v1` · still
`packageNote=partial_first_result` · `fullPackageReady=false`. Deferred
03/04/05 remain refused (never invent pass).

## Related

- Executed green bundle: `GREEN-BUNDLE.md`
- Acquisition status (full matrix): `ACQUISITION.md`
- Fresh consumer wiring: `CONSUMER.md`
- Frozen evidence: `FROZEN-E2E-PACKET-S152.md`
