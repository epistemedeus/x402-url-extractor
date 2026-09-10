# S127 concurrency graph (planned before execution)

Hypothesis: binding an upstream package export/API change to the caller's
**actually used** import surface yields a replayable `action|unknown` packet
that is more useful than "a newer version exists" (S122 baseline).

Kill if: after real tests, mapping adds no actionable value over direct
registry/release fetch + changelog skim.

## Disjoint cells (owned write paths)

| ID | Role | Owns (write) | Depends on | Parallelizable with |
| --- | --- | --- | --- | --- |
| c01 | Input normalization | `cells/c01-normalize/`, `src/normalize.mjs` | — | all other leaves |
| c02 | Lockfile/alias/workspace | `cells/c02-lockfile-alias/`, `src/lockfile.mjs` | — | all other leaves |
| c03 | Static import analysis | `cells/c03-static-imports/`, `src/imports.mjs` | — | all except c06 writer |
| c04 | Source acquisition/provenance | `cells/c04-source-acq/`, `src/acquire.mjs` | — | all other leaves |
| c05 | Export-diff semantics | `cells/c05-export-diff/`, `src/export-diff.mjs` | — | all other leaves |
| c06 | Usage→change binding | `cells/c06-usage-bind/`, `src/bind.mjs` | c03,c05 contracts | readers of c03/c05 |
| c07 | Unknown/partial rules | `cells/c07-unknown-partial/`, `src/unknown.mjs` | — | all other leaves |
| c08 | Prior/correction state | `cells/c08-prior-correct/`, `src/prior.mjs` | — | all other leaves |
| c09 | CLI + SKILL entry | `cells/c09-cli-packaging/`, `scripts/`, `skills/` | contracts | after stubs exist |
| c10 | Tests + synthetic fixtures | `cells/c10-tests-fixtures/`, `fixtures/synthetic/`, `test/` | contracts | after stubs |
| c11 | Real-source case A | `cells/c11-real-a/`, `fixtures/real-a/` | c04 | c12 |
| c12 | Real-source case B | `cells/c12-real-b/`, `fixtures/real-b/` | c04 | c11 |
| c13 | Dep/license reuse audit | `cells/c13-dep-license/` | — | all |
| c14 | Hostile input cases | `cells/c14-hostile/`, `fixtures/hostile/` | — | all |
| c15 | Native cold consumer A | `cells/c15-cold-a/` | pack CLI | after integrate |
| c16 | Native cold consumer B | `cells/c16-cold-b/` | pack CLI | after integrate |

## Launch policy
- Wave 1: c01–c14 (14 OS sessions) concurrently — all leaves ready now.
- Wave 2: admit more distinct contract/cold/source cases only if MemAvailable≥25%, PSI quiet, and latency OK; target learning whether meaningful work exceeds prior ~25-proc lower bound — not quota padding.
- Wave 3: c15–c16 cold consumers after integrator wires CLI.
- Integrator (parent Cursor + one Heavy session): merges into `src/`, `scripts/cli.mjs`, tests; single cohesive branch.

## Distinction
- **OS session**: `grok --prompt-file …/s127/…` process we launched.
- **Model-native child**: any grok/subagent process without our prompt-file (Heavy-internal).
Record both in receipts; do not conflate.

## Non-goals / exclusions
- Do not modify S124 marketplace or S125 Pulse packages.
- No package script execution from untrusted tarballs (`npm install` scripts off / tar extract only).
- No external posting, accounts, payments, daemon, default merge.
