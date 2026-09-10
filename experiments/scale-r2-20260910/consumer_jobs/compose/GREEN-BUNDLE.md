# Offline green-only executed first-result bundle (S159)

Literal buyer/operator path that **actually runs** the four offered green
recipes against their default fixtures and packages a buyer-facing bundle.
Schema: `x402.r2.consumer.green_first_result_bundle.v1`.

Package note is **`partial_first_result`**. `fullPackageReady` is always
**false**. This is **not** a full ready package claim.

Reuses `S152_POSITIVE_PARTIAL_MATRIX`, `KNOWN_EXTERNAL_HEAVY_DEFECTS`, and
`first-result.mjs` offer logic — no truth fork.

## Exact partial (green executed)

| id | jobRef | slotStatus | heavyDecision | runner |
|---|---|---|---|---|
| migration-checklist | R2-CONSUMER-JOBS-01 | ready | pass | Heavy S137 CLI analyze |
| release-brief | R2-CONSUMER-JOBS-02 | ready | pass | Heavy S137 CLI analyze |
| freshness-receipt | R2-CONSUMER-JOBS-06 | ready | pass | Heavy S137 CLI analyze |
| procurement-brief | R2-CONSUMER-JOBS-07 | ready | — | sibling 07 `brief` |

Default fixtures (local paths; URLs stay data — no fetch):

- migration-checklist → `s137…/fixtures/synthetic/migration/cases/positive-complete.json`
- release-brief → `s137…/fixtures/synthetic/release-brief/cases/positive-aligned.json`
- freshness-receipt → `s137…/fixtures/synthetic/freshness/cases/positive-complete.json`
- procurement-brief → `consumer_jobs/07/fixtures/positive.json`

## Deferred — external Heavy CLI defects (NOT executed)

| id | jobRef | slotStatus | heavyDecision | classification |
|---|---|---|---|---|
| table-reconcile | R2-CONSUMER-JOBS-03 | failed | fail | external Heavy CLI analyze fail |
| link-index | R2-CONSUMER-JOBS-04 | failed | fail | external Heavy CLI analyze fail |
| replay-pack | R2-CONSUMER-JOBS-05 | failed | fail | external Heavy CLI analyze fail |

These are **not** `unavailable_pending_heavy`. Do **not** invent Heavy pass.
Do **not** run-as-pass on this lane. Do **not** ask this surface to “fix”
03/04/05. Deferred to Heavy parent.

**Green bundle remains the buyer path until deferred cells clear.** To
recheck deferred cells later (record actual CLI; never invent cleared),
use `RECHECK.md` / `recheck-deferred`.

Also documented (still offered for positive path): some release-brief
**conflict** fixtures via CLI return pass instead of conflict — external
defect deferred to Heavy; positive release-brief remains green. This lane
does **not** invent conflict outcomes.

## Operator steps (executed green bundle)

```sh
cd experiments/scale-r2-20260910/consumer_jobs/compose

# 1) Execute all four green recipes → demo-out/green-bundle/
node src/cli.mjs green-bundle --json
# equivalent:
node src/cli.mjs first-result --execute --json

# 2) Inspect bundle + packets
ls demo-out/green-bundle/
ls demo-out/green-bundle/packets/
# bundle.json · packets/migration-checklist.json · …
#             · packets/release-brief.json
#             · packets/freshness-receipt.json
#             · packets/procurement-brief.json

# 3) Optional: subset of green ids only
node src/cli.mjs green-bundle --recipe procurement-brief --out demo-out/green-bundle-pb --json

# 4) Dry offer / plan (no spawn) still available
node src/cli.mjs first-result --json
node src/cli.mjs first-result --plan --json
```

## Refuse deferred ids

```sh
# Must exit non-zero with deferred_recipe_refused — never invent pass
node src/cli.mjs green-bundle --recipe table-reconcile --json
node src/cli.mjs green-bundle --recipe link-index --json
node src/cli.mjs green-bundle --recipe replay-pack --json
node src/cli.mjs first-result --execute --recipe table-reconcile --json
```

## Bundle shape (machine)

```json
{
  "schema": "x402.r2.consumer.green_first_result_bundle.v1",
  "packageNote": "partial_first_result",
  "packageStatusHint": "partial",
  "fullPackageReady": false,
  "firstResultReady": true,
  "acquisitionOk": true,
  "executedOk": true,
  "clock": "2026-09-10T18:00:00.000Z",
  "offered": [ { "id": "migration-checklist", "executed": true, "executionOk": true } ],
  "results": [ { "id": "migration-checklist", "ok": true, "heavyDecision": "pass", "packetPath": "…" } ],
  "deferredExternalDefects": [ { "id": "table-reconcile", "kind": "heavy_cli_analyze_fail" } ],
  "resolvedCommits": {
    "heavyResolvedInputCommit": "fa6878de125cfdcfd77f4b47037c88667090d293"
  }
}
```

## Exit codes

| Condition | Exit |
|---|---|
| Green bundle executed (all selected ok) | **0** |
| Deferred recipe requested | 1 (`deferred_recipe_refused`) |
| Unknown recipe id / execution failure | 1 |
| Usage / unknown command | 2 |

## Forbidden claims

No investment recommendation, revenue projection, ranking, escrow, custody, or
“full package ready for paid acquisition” language. Fixture URLs remain data.
Do not re-run Heavy 03/04/05 to force a pass on this lane. Do not invent
release-brief conflict outcomes.

## Related

- Dry first-result offer: `FIRST-RESULT.md`
- Acquisition status (full matrix): `ACQUISITION.md`
- Deferred Heavy cell recheck (03/04/05 truth recording): `RECHECK.md`
- Fresh consumer wiring: `CONSUMER.md`
- Frozen evidence: `FROZEN-E2E-PACKET-S152.md`
