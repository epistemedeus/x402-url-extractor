# Deferred Heavy cell recheck harness (S159)

Operator tool that **re-runs only deferred Heavy recipes** (table-reconcile /
link-index / replay-pack) against their known positive fixtures, records
**actual** CLI decisions, and emits a delta vs `KNOWN_EXTERNAL_HEAVY_DEFECTS`
and the S152 positive partial matrix.

Schema: `x402.r2.consumer.deferred_recheck.v1`.

## What this is

- A **truth-recording** recheck for acquisition operators.
- Runs deferred ids **03 / 04 / 05** only (unless `--include` lists a subset of
  those known deferred ids).
- Per-cell: `id`, `jobRef`, `expectedDefect`, `actualDecision`,
  `status` ∈ `still_deferred` | `cleared` | `unexpected`.
- `cleared` **only** if `actualDecision === "pass"` from the real Heavy CLI
  (or an explicit test spawn injection) — **never hardcoded / invented**.
- Overall note stays **partial** (`partial_deferred_recheck`) while any cell is
  `still_deferred`.
- Reuses `S152_POSITIVE_PARTIAL_MATRIX`, `KNOWN_EXTERNAL_HEAVY_DEFECTS`, and the
  same Heavy spawn helper as the green bundle — **no truth fork**.

## What this is not

- **Not** an invent-as-pass path for deferred Heavy cells.
- **Not** a release-brief conflict invent surface.
- **Not** a replacement for the green-only buyer path. **Green bundle remains
  the buyer path until deferred cells clear.**
- **Not** a full ready-package claim (`fullPackageReady` stays `false`).
- Fixture URLs stay data — no fetch.

## Today’s expected outcome

Against current Heavy CLI on synthetic positives: all three deferred cells
return **fail** → report `still_deferred`. When Heavy later fixes analyze, the
**same** tool reports `cleared` from real `pass` packets — this package does
not invent pass today.

## Operator steps

```sh
cd experiments/scale-r2-20260910/consumer_jobs/compose

# Recheck all deferred Heavy cells (03/04/05)
node src/cli.mjs recheck-deferred --json
# equivalent npm script:
npm run recheck-deferred

# Subset of known deferred ids only
node src/cli.mjs recheck-deferred --include table-reconcile --json

# Exit 1 if any still_deferred (gate for later “all clear” checks)
node src/cli.mjs recheck-deferred --require-cleared --json

# Artifacts
ls demo-out/deferred-recheck/
# recheck.json · packets/table-reconcile.json · …
```

## Refuse non-deferred

```sh
# Must exit non-zero with non_deferred_refused — green ids are not rechecked here
node src/cli.mjs recheck-deferred --include migration-checklist --json
node src/cli.mjs recheck-deferred --include release-brief --json
```

## Cell status rules

| actualDecision (from CLI) | status |
|---|---|
| `fail` | `still_deferred` |
| `pass` | `cleared` |
| anything else / missing | `unexpected` |

Invariant: `status === cleared` ⇒ `actualDecision === "pass"`. Violating that
is refused (`invent_cleared_refused`).

## Example machine output (shape)

```json
{
  "schema": "x402.r2.consumer.deferred_recheck.v1",
  "packageNote": "partial_deferred_recheck",
  "packageStatusHint": "partial",
  "fullPackageReady": false,
  "overallStillDeferred": true,
  "cells": [
    {
      "id": "table-reconcile",
      "jobRef": "R2-CONSUMER-JOBS-03",
      "expectedDefect": {
        "kind": "heavy_cli_analyze_fail",
        "expectedDecision": "fail"
      },
      "actualDecision": "fail",
      "status": "still_deferred"
    }
  ],
  "summary": {
    "stillDeferredIds": ["table-reconcile", "link-index", "replay-pack"],
    "clearedIds": []
  },
  "deltaVsKnownDefects": {
    "stillMatchingDefect": [],
    "newlyCleared": []
  }
}
```

## Exit codes

| Condition | Exit |
|---|---|
| Recheck ran (including still_deferred) | **0** |
| `--require-cleared` and any still_deferred | 1 |
| Non-deferred `--include` / tool error | 1 |
| Usage / unknown command | 2 |

## Forbidden claims

No investment recommendation, revenue projection, ranking, escrow, custody, or
“full package ready” language. Do not invent Heavy pass on 03/04/05. Do not
invent release-brief conflict outcomes. Fixture URLs remain data.

## Related

- Green executed buyer path: `GREEN-BUNDLE.md` (remains buyer path until clear)
- Acquisition status (full matrix): `ACQUISITION.md`
- Dry first-result offer: `FIRST-RESULT.md`
- Frozen evidence: `FROZEN-E2E-PACKET-S152.md`
