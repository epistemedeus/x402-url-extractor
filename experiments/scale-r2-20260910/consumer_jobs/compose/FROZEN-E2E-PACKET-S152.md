# FROZEN-E2E-PACKET-S152

Bot: BOT-S152 · Pilot Useful Agent Work R2 · Native shell only (no CloudAgent)  
Frozen: 2026-09-10 (PT) · Schema package `x402.r2.consumer.customer_result_package.v1` · Heavy packets `s137.consumer-evidence.packet.v1`

## Commits

| Role | Ref |
|---|---|
| Native 07 tip | `b1b0db112985ee06b625ef1bef8c8770e336ce25` (`codex/r2-consumer-jobs-07-20260910`) |
| Native 08 base | `6d1376c8f1561114bf632bd437d54343b7d1894c` (`codex/r2-consumer-jobs-08-20260910`) |
| Heavy S137 | `fa6878de125cfdcfd77f4b47037c88667090d293` (`resolvedInputCommit`) |
| Compose HEAD | `1000ba71522502e68b0689fde9dcc4e1a700816e` (`codex/r2-consumer-s152-compose-20260910`) |

## Inputs (fixture paths + clock)

Operator clock: `2026-09-10T18:00:00.000Z`

| Recipe / jobRef | Artifact | --in (synthetic positive unless noted) |
|---|---|---|
| R2-CONSUMER-JOBS-01 | migration-checklist | `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/migration/cases/positive-complete.json` |
| R2-CONSUMER-JOBS-02 | release-brief | `…/release-brief/cases/positive-aligned.json` |
| R2-CONSUMER-JOBS-03 | table-reconcile | `…/table-reconcile/cases/positive-agree.json` |
| R2-CONSUMER-JOBS-04 | link-index | `…/link-index/cases/positive-md` |
| R2-CONSUMER-JOBS-05 | replay-pack | `…/replay-pack/cases/positive-unpaid-complete` |
| R2-CONSUMER-JOBS-06 | freshness-receipt | `…/freshness/cases/positive-complete.json` |
| R2-CONSUMER-JOBS-07 | procurement-brief | `experiments/scale-r2-20260910/consumer_jobs/07/fixtures/positive.json` |

Conflict refusal fixtures:

- migration-checklist → `…/migration/cases/conflict-challenge-resource.json` → decision **conflict**
- freshness-receipt → `…/freshness/cases/conflict-retrieved-before-source.json` → decision **conflict**

CLI shape: `node <cli> analyze <artifact> --in <fixture> --clock <ISO> [--out <path>]`  
Heavy CLI relative from 08: `../../../s137-consumer-evidence-jobs/scripts/cli.mjs`

## Read paths

- Heavy pack: `experiments/s137-consumer-evidence-jobs/` (vendored at fa6878de; pin file `RESOLVED-INPUT-COMMIT.txt`)
- Native 07/08: `experiments/scale-r2-20260910/consumer_jobs/{07,08}/`
- Compose surface: `experiments/scale-r2-20260910/consumer_jobs/compose/`
- Recipes: `08/recipes/{migration-checklist,release-brief,table-reconcile,link-index,replay-pack,freshness-receipt,procurement-brief}.json`
- Journey outputs: `08/demo-out/s152/` and `compose/demo-out/`

## Journey results (real CLI; not invented)

Positive package status: **partial** (expected while Heavy CLI returns fail for 03/04/05)

| id | slot status | Heavy decision |
|---|---|---|
| migration-checklist | ready | pass |
| release-brief | ready | pass |
| table-reconcile | failed | fail |
| link-index | failed | fail |
| replay-pack | failed | fail |
| freshness-receipt | ready | pass |
| procurement-brief | ready | (07 brief ready) |

Conflict partial: migration + freshness **conflict**; procurement-brief **ready**; package **partial**.  
Unknown recipe → package **rejected**. Forbidden `investmentRecommendation` → **rejected**.  
URL / path-escape / missing clock / missing `--in` → wrapper **rejected** (`unsafe_path` \| `missing_clock` \| `missing_in`).

## Tests run (THIS task only — do not cite Heavy 126)

| Surface | Command | Result |
|---|---|---|
| consumer_jobs/08 | `npm test` | **16/16 pass** |
| consumer_jobs/compose | `npm test` | **6/6 pass** |
| **Total compose acceptance** | | **22/22 pass** |

## Limitations / source defects for Lead

### Wrapper bugs fixed in S152

- Replaced `unavailable_pending_heavy` placeholders with `status: ready` recipes wired to S137 CLI + fixtures.
- Extended `assemble.mjs` to spawn Heavy analyze; map decisions without inventing pass.
- Path/URL safety, missing clock, missing `--in` refusals at wrapper.
- `--out` allowlist extended so compose `demo-out` packet dumps are permitted.

### Heavy defects deferred (do not “fix” in compose)

1. **CLI analyze ≠ smoke transform path for 03/04/05:** `scripts/smoke-fixtures.mjs` reaches `decision=pass` via fixture loaders + direct transforms; CLI `analyze` on the same positive cases returns **fail** for `table-reconcile`, `link-index`, `replay-pack` (schema-rejected / transform-threw / incomplete coerce). Compose records real fail packets.
2. **release-brief conflict fixtures via CLI often return `pass`** (e.g. `conflict-sha-mismatch`) instead of conflict — conflict refusal tests use migration + freshness where CLI correctly returns `conflict`.
3. **CLI `analyze` on whole synthetic dirs** (mixed cases) yields fail; operators must pass specific case paths. Documented in recipes’ `defaultIn`.
4. Heavy RESULT.md already notes CLI pass confirmation mainly for release-brief / freshness-receipt; S152 confirms migration-checklist case JSON also passes via CLI.

## Non-claims

- No publication, payment, live fetch, or investment recommendation.
- Fixture URLs kept as data (not auto-executed).
- No CloudAgent used.
