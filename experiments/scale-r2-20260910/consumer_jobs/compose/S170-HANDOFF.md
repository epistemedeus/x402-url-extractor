# S170 / S169 PIN — Lead handoff

## Identity
- Branch: `codex/r2-consumer-s170-s153-recheck-20260910`
- Base tip: `1ade0d81c30eb12d3c1e5fefd40df35a5df83ada` (S159 recheck)
- Resolved S153 merchant commit: `d520699802622a715cde1d894cc5547c42b2dca7`
- S153 branch source: `codex/s153-consumer-distribution-gates-20260910`
- quota_reset_exact=`2026-09-10T12:48:15.801Z`

## Paths (honest pins)
- Maintained S137 root: `experiments/s137-consumer-evidence-jobs` (NOT a separate `s137-consumer-evidence` dirname)
- Kit: `experiments/s153-consumer-distribution-gates/kit`
- Kit tarball: `experiments/s153-consumer-distribution-gates/kit/dist/s137-consumer-evidence-kit.tgz`
- Kit CLI: `experiments/s153-consumer-distribution-gates/kit/bin/cli.mjs` → sibling S137 `scripts/cli.mjs`
- Compose recheck: `experiments/scale-r2-20260910/consumer_jobs/compose/`
- Pin file: `compose/RESOLVED-S153-COMMIT.txt`
- Terminal head: `compose/receipts/s170-recheck-terminal.txt`

## Integration (no source fork)
- Brought kit + aligned S137 sibling from `d520699…` onto S170 branch (checkout paths only; no rewrite of 01–06 transforms).
- Deferred 03/04/05 default spawn → S153 kit CLI + kit examples.
- `--inputs s137-synthetic` retains prior synthetic positives.
- Kit excludes 07/08; native `consumer_jobs/07` + `08` + compose green-bundle own them.
- Heavy 01–06 ownership unchanged. No CloudAgent. No duplicate source fork.

## CLI command lines
```sh
# install/unpack
tar -xzf experiments/s153-consumer-distribution-gates/kit/dist/s137-consumer-evidence-kit.tgz \
  -C /tmp/s137-consumer-kit --strip-components=1
node /tmp/s137-consumer-kit/bin/cli.mjs analyze replay-pack \
  --in /tmp/s137-consumer-kit/examples/replay-pack --clock 2026-09-10T12:00:00.000Z

# deferred recheck (default = S153 kit)
cd experiments/scale-r2-20260910/consumer_jobs/compose
node src/cli.mjs recheck-deferred --json
node src/cli.mjs recheck-deferred --inputs s137-synthetic --json

# green 01/02/06/07
node src/cli.mjs green-bundle --clock 2026-09-10T12:00:00.000Z --table
```

## Recheck decisions (decision field; never ok===true)

### Default s153-kit examples @ 2026-09-10T12:00:00.000Z
| id | decision | status |
|---|---|---|
| table-reconcile (03) | **partial** | unexpected |
| link-index (04) | **fail** | still_deferred |
| replay-pack (05) | **pass** | cleared |

### Legacy s137-synthetic positives
| id | path | decision | status |
|---|---|---|---|
| table-reconcile | fixtures/.../positive-agree.json | **fail** | still_deferred |
| link-index | fixtures/.../positive-md | **fail** | still_deferred |
| replay-pack | fixtures/.../positive-unpaid-complete | **fail** | still_deferred |

### Kit examples 01/02/06 (unpacked)
migration-checklist=pass, release-brief=partial, freshness-receipt=pass

### Green-bundle native
01/02/06/07 execOk=true (Heavy decisions pass on green recipes’ default fixtures); 03/04/05 not executed on green path.

## Defect for Lead→Root (S158 Heavy owner)
```
node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze release-brief \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/cases/conflict-sha-mismatch.json \
  --clock 2026-09-10T12:00:00.000Z
→ decision=pass, ok=true, finding id=cli.schema-rejected
```
Expected conflict/fail did **not** hold. Do not invent pass clearance for conflict fixtures.

## Status mapping
pass→cleared; fail→still_deferred; partial/conflict/other→unexpected. cleared only if actualDecision==="pass".

## Tests
- compose: **44/44 pass** (`node --test tests/*.test.mjs`)
- recheck-deferred: **15/15 pass**
- Kit native 217 tests / 48 cells: **not** treated as Root release acceptance.

## Limitations
- overallStillDeferred=true (link-index fail on kit examples; synthetics all fail).
- fullPackageReady stays false; green bundle remains buyer path.
- release-brief conflict-sha-mismatch defect persists (pass + schema-rejected).
- No invent of pass on deferred cells; partial recorded as unexpected.
