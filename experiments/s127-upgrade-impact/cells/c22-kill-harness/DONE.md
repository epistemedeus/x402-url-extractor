# c22-kill-harness DONE

Stage-1 kill-condition harness. Offline. No payment.

## Outputs

Measurable kill (see `KILL-CONDITION.md`):

- Method A = registry version + changelog skim stub (`lib/skim.mjs`).
- Method B = usage-binding packet (`summary.nextAction`).
- Default compare is **coarse buckets** (`action | no_action | unknown`) so `review_changelog` and packet `action` are the same operator move.
- Two JSON files → pair `keep|kill|unknown`.
- Required cases A and B → product `keep|kill|unknown`. Missing required files stay **unknown**, not kill.

Shipped suite results (synthetic, not paid-job evidence):

| Suite | Verdict | Why |
| --- | --- | --- |
| `fixtures/suites/synthetic-keep.json` | `keep` | stand-in A withholds (`review_changelog` → `no_action`); stand-in B matches action-like |
| `fixtures/suites/synthetic-kill.json` | `kill` | both required cases stay action-like |
| `fixtures/suites/real-ab.json` | `unknown` | drop-in method JSON not present (c11/c12 not owned here) |
| `fixtures/suites/incomplete.json` | `unknown` | case B method B path missing |

Pair keep directions covered:

1. Unused major removal vs screaming changelog → B changes A (withhold).
2. Silent patch changelog vs used signature change → B changes A (catch).

`node --test test/*.test.mjs`: **37 pass / 0 fail**. `node harness.mjs selftest`: ok, failed=0.

`payment.attempted` is always false. `assignmentSpendUsd` is 0.

## Isolation self-check

`node harness.mjs isolation` → `ok: true`, `escapedWrites: []`.

Jail refuses writes to `cells/c11-real-a`, `cells/c12-real-b`, `fixtures/real-a`, `fixtures/real-b`, pack `src/` `scripts/` `skills/` `test/`, and S124/S125 trees. `--out` stays under this cell unless `--allow-tmp`.

Did not modify S124 marketplace, S125 Pulse, S122 trees, or pack `src/` / `scripts/`. No `npm install`. No lifecycle scripts. No network.

## Fixture vs live-capture

**All authored files in this cell are `synthetic`.** Not live-capture. Not paid demand.

Changelog SHA-256 (authored text):

- `fixtures/cases/synthetic-standin-a/changelog.md` = `fixtures/cases/synthetic-standin-b/changelog.md` = `58202552052ee65bc05c3e4ebac9319da31a3b4a876ecc4f4b6e1235ec331413`
- `fixtures/cases/changelog-silent-used-break/changelog.md` = `85bc7239ea96bb89811fba612030e7c500da1356d9d2b4cefe347f253928d079`

S122 npm recipes and S127 `fixtures/synthetic/` caller trees are **read-only reuse**, not copied. Clock: `2026-09-10T12:00:00.000Z` (`fixtures/CLOCK.txt`).

## Limitations

- Method A keyword scan is stub regex, not changelog understanding and not TypeScript analysis.
- Coarse mapping is the product kill. `--mode exact` is diagnostic (`review_changelog` ≠ `action` as strings).
- Synthetic stand-ins are not real-source cases A/B. Product keep/kill waits on drop-ins from c11/c12 (or integrator copies of their decision JSON).
- Harness does not re-run bind/export-diff; it trusts `summary.nextAction` (falls back to bindings if summary is missing).
- Dynamic import / partial source / lockfile disagreement are other cells' jobs; this harness only compares already-made decisions.
- No full TS program analysis. TS/dynamic surfaces stay unknown if the producer labeled them that way.

## Integrator notes

```bash
cd experiments/s127-upgrade-impact/cells/c22-kill-harness
node harness.mjs compare <method-a.json> <method-b.json>
node harness.mjs suite fixtures/suites/real-ab.json
node harness.mjs skim <registry-skim-input.json>
```

Insert **before bumping a pin** (see `STAGE1-EXPERIMENT.md`): S122-style skim → usage-binding packet → this compare → only then bump or withhold.

Drop real A/B decisions into `fixtures/drop-in/real-a/{method-a,method-b}.json` and `real-b/`. Do not write those from this cell into `fixtures/real-a` or `cells/c11-real-a`.

Do not treat `synthetic-keep` as a paid-job keep. Do not treat empty `real-ab` as a kill.

## Exact files written

All under `experiments/s127-upgrade-impact/cells/c22-kill-harness/`:

- `harness.mjs`
- `isolation-self-check.mjs`
- `lib/compare.mjs`
- `lib/constants.mjs`
- `lib/extract.mjs`
- `lib/io.mjs`
- `lib/paths.mjs`
- `lib/skim.mjs`
- `lib/suite.mjs`
- `test/compare.test.mjs`
- `test/harness.test.mjs`
- `test/isolation.test.mjs`
- `test/skim.test.mjs`
- `fixtures/CLOCK.txt`
- `fixtures/PROVENANCE.json`
- `fixtures/cases/synthetic-standin-a/{changelog.md,registry-skim-input.json,registry-skim-decision.json,binding-packet.json}`
- `fixtures/cases/synthetic-standin-b/{changelog.md,registry-skim-input.json,registry-skim-decision.json,binding-packet.json}`
- `fixtures/cases/changelog-silent-used-break/{changelog.md,registry-skim-input.json,registry-skim-decision.json,binding-packet.json}`
- `fixtures/cases/kill-both-action/case-a/{registry-skim-decision.json,binding-packet.json}`
- `fixtures/cases/kill-both-action/case-b/{registry-skim-decision.json,binding-packet.json}`
- `fixtures/cases/partial-changelog/{registry-skim-input.json,registry-skim-decision.json}`
- `fixtures/cases/same-version/{registry-skim-input.json,registry-skim-decision.json}`
- `fixtures/suites/{synthetic-keep,synthetic-kill,real-ab,incomplete}.json`
- `fixtures/drop-in/real-a/README.md`
- `fixtures/drop-in/real-b/README.md`
- `fixtures/out/README.md`
- `fixtures/out/skim-standin-a.json` (generated sample; tests recreate)
- `KILL-CONDITION.md`
- `STAGE1-EXPERIMENT.md`
- `README.md`
- `DONE.md`

## No paid claims

Stage-1 experiment only. No accounts, posting, daemon, default-branch merge, or payment replay.
