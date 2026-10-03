# RESULT — Sol339 task-to-demand projection

Completed an isolated module at `task-linked-delivery/experiments/task-demand-100339`.
Source and tests: `dd30439b991b4fbecc67365af68f7fd2acaccc91` on
`codex/sol-task-demand-100339`, based on merchant
`5008b5e7213511e26eb3d369fcc0056e48b4ef20`. The later artifact commit contains
this result, the standalone licensed candidate and retained receipts.

## Decisions improved

- Repair the next missing stage: each server-bound attempt names its valid
  delivery, usefulness, retention, later-read and runtime-settlement gaps,
  including native failure codes and absent, torn or conflicting evidence.
- Compare only covered cohorts: explicit operation/cohort/task scopes and
  aligned time cuts constrain attempt denominators; owner/internal,
  recruited/sponsored, attributable independent and unclassified records stay
  separate. All-market traffic stays unknown.
- Stop or retest usefulness: an agreed negative can support a bounded later
  read; changed usefulness, revoked/expired grants and ambiguous owners remain
  visible, without preserving stale positive evidence after replacement.
- Budget another marginal attempt: direct baseline, review/adaptation, cash,
  API-equivalent probes/tokens, quota and shared R&D remain separate. Historic
  2.85 USDC commission tokens stay unknown and the commission is not recalibrated.

## Exact source and contract

`PIN.json` names and hashes the real causal producer, native forward/task-ref
predicates, outcome reconciler, received journal325, receipt-retention contract,
observer/outcome export consumers and executable useful-economics sources.
Readonly causal excerpts have native predicate parity tests; economics files
are byte-identical. No wallet, digest, actor/UA, HTTP200, success flag or archive
fetch establishes task identity or repairs missing causal evidence.

`src/observer-integration.mjs` consumes explicitly supplied supported read-only
exports. The generic HTTP validator does not support the receipt route; the
projection uses its received receipt-retention contract and exact runtime
reconciliation instead. Native forward retained-use rows lack timing/grant
ownership, so those rows alone cannot establish later use. The supplied
source manifest declares completeness; an offline file's authenticity is not
independently verified, and the report explicitly states that limitation.

## Executed validation

Node v22.22.2 on the supplied VM. `evidence/validation.json` records exact
commands, test-log SHA-256s and code/harness hashes.

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Isolated projection/CLI/native observer/cold export | 15 | 0 |
| Received commerce, journal325, settlement and economics replay | 208 | 0 |
| Existing public-acquisition engine/receiving tools | 31 | 0 |

The cases cover two supplied questions, stripped files and stdin, missing
causal sides, wrong task/owner, duplicate/conflicting/late/torn evidence,
misaligned scopes and times, changed usefulness/grants, useful negatives,
restarted replay, replaced evidence, bounds and hard deadline. Seeded success,
zero-value reconciliation, forged retained record id and owner-QA outside-use
claims are refused. Replay files strip rejected rows to material digests.

Retained machine reports are `evidence/retention-friction.retained.json` and
`evidence/negative-utility.retained.json`. Both were recomputed in new CLI
processes with byte-identical output. They are synthetic measurements.

## Standalone licensed cold candidate

`export/public/manifest.json` is an isolated candidate for existing
`public-acquisition/engine.mjs` tools; no global catalog or server mount changed.
Archive: `task-demand-100339-0.1.0.tar.gz`, 29093 bytes,
18 allowlisted members, MIT license.

- Source commit: `dd30439b991b4fbecc67365af68f7fd2acaccc91`
- Archive SHA-256: `44209579e6a005e6f80dbe7f26946fbb4a52b236d8c32e326eba5761b4d749f5`
- Source member-tree digest: `cedb6d34dac45dc51035ee64dd8d56447d276e6870ef00e7c3ce56d1ccaf1992`
- Receipt: `evidence/cold-receipt.json`, observed `2026-10-02T12:28:56.748Z`

The existing engine served index, archive, provenance, license and notice on
loopback. GET/HEAD sizes and SHA-256s matched. Two extracted consumers ran six
fresh query/replay processes plus three standalone portable tests without
merchant dependencies or provider credentials. Restart and changed-evidence
replays passed. Exact source-member bytes were repacked from the committed
source and the resulting archive hash matched.

This receipt is loopback owner QA. It is not production hosting or outside
use. All public-pack evidence is synthetic; no secrets or real raw private
journals were read into it. No actual market aggregate is claimed. Recognized
revenue remains zero.

## Root's isolated integration proposal

See `ROOT-INTEGRATION.md`: Root can pass its existing authorized bounded
read-only cuts to `exportObserverSource`, then call `projectObserverEvidence`
with the task question. Caller-retained reports supply replay without another
analytics database. Root owns any shared route and authorization integration.
The existing aggregate snapshots cannot fill missing task denominators. No
journals, payment rails/prices, hosted subscription, DB/crawler, global catalog,
Neo L09, public marketing copy, merge, deployment, contact, overage or reset
was changed. The existing acquisition test's generated loopback-profile file
was restored after verification.
