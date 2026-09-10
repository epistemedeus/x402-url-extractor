# S127 RESULT — upgrade-impact packet (2026-09-10)

## Hypothesis

An agent runtime/dependency **upgrade-impact packet** that binds an **actual**
upstream export/API change to the caller's **actually used** import surface
produces a better replayable `action | unknown | no_action` decision than
registry version + changelog skim alone.

This is a narrow offline experiment, not a universal compatibility oracle.
S124 marketplace and S125 Pulse packages were not modified.

## Branch / location

- Branch: `codex/s127-upgrade-impact-20260910`
- Parent tip: S122 `c0255ac`
- Pack: `experiments/s127-upgrade-impact/`
- Merchant API / payments: untouched

## Concurrency (native Heavy)

Concrete disjoint work graph in `CONCURRENCY-GRAPH.md`. Ready leaves were
dispatched as separate OS `grok --prompt-file` sessions (not sequential prose).

| Metric | Observed |
| --- | --- |
| Peak OS s127 sessions | **28** |
| Peak grok-related procs | **29** |
| Waves | 14 → +8 → +4 meaningful cells (stopped; no quota padding) |
| Prior lower bound | ~25 OS sessions; this run **exceeded** it with real owned-path work |

Model-native Heavy children are distinct from OS sessions; receipts under
`/workspace/experiments/scale-20260909/s127/receipts/`. Full transcripts stay
private/VM-local.

## What shipped

- `src/*` stages: normalize, lockfile, acquire, imports, export-diff, bind, unknown, prior
- `scripts/cli.mjs` + `skills/upgrade-impact/SKILL.md`
- Synthetic fixtures + goldens (used removal, unused removal, same-version, dynamic, partial, alias, ranges)
- Real case A: `path-to-regexp` **6.3.0 → 8.4.2** (CJS named bag)
- Real case B: `cookie` **1.1.1 → 2.0.1** (CJS→ESM / export rename surface)
- Stage-1 kill harness (`cells/c22-kill-harness`) comparing registry+changelog skim vs usage-binding
- Cold consumers `c15` / `c16` calling only the public CLI

## Acceptance evidence

| Check | Result |
| --- | --- |
| Pack `node --test test/*.test.mjs` | **71/71 pass** |
| Kill harness tests | **37/37 pass** |
| CLI synthetic used-removed | `nextAction=action` (`alpha`) |
| CLI same-version | `nextAction=no_action` |
| Real A CLI / cold-a | `action` on used `pathToRegexp`, `tokensToFunction` (+ `regexpToFunction`); unused additions `no_action` |
| Real B CLI / cold-b (parse-only caller) | `action` on used `parse`; unused `serialize` not a caller defect |
| Missing/partial / dynamic / lockfile disagreement | covered in synthetic suite + unknown policy |
| Clean archive install | offline CLI; no lifecycle scripts; fixture dirs accepted |

Load-bearing export claims were checked against published package trees (tar
extract only; no `npm install`).

## Stage-1 kill condition (no payment)

Method A = registry version + changelog skim stub (`review_changelog` on majors).
Method B = usage-binding packet (`action` when a used export breaks).

Coarse buckets (product kill): `review_changelog` and `action` are the **same**
operator move.

| Suite | Verdict |
| --- | --- |
| `synthetic-keep` | **keep** (withhold / catch stand-ins) |
| `synthetic-kill` | **kill** (machinery self-check) |
| `real-ab` (path-to-regexp + cookie majors) | **kill** |

**Honest product outcome:** on these two real major upgrades, binding did **not**
change the coarse operator move vs "read registry + changelog." Under the
stated kill condition, **stop packaging usage-binding as a paid job**.

Residual reusable value (not revenue, not customer demand):

- Names the **used** broken exports (agents can edit those call sites)
- Withholds action on **unused** removals (synthetic keep direction still works)
- Replayable packet + correction/prior immutability

Next specific decision: keep this as a **free offline agent assist** inside
existing workflows; do not sell it as a paid upgrade oracle unless a future
case set shows coarse-bucket decision changes on real pairs (e.g. silent patch
breaks, or major churn that is entirely unused).

## Non-claims

- Not customer demand. Not banked revenue. Assignment spend $0.
- No external posting, accounts, payments, daemon, or default-branch merge.
- A newer version alone is not a break. Unused export change is not a caller defect.
