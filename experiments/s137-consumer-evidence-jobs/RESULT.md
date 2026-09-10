# S137 consumer evidence jobs (R2-CONSUMER-JOBS-01..06)

## Scope

Owned slice from private Pilot `READY-PORTFOLIO-R2.json` (commit `4892421348329946476bb16bc17e2c82ef87a1a3`):

| Job | Artifact |
|---|---|
| R2-CONSUMER-JOBS-01 | Documentation migration checklist |
| R2-CONSUMER-JOBS-02 | Release evidence brief |
| R2-CONSUMER-JOBS-03 | Research table reconciliation |
| R2-CONSUMER-JOBS-04 | Link-to-artifact index |
| R2-CONSUMER-JOBS-05 | API example replay pack |
| R2-CONSUMER-JOBS-06 | Dataset freshness receipt |

Jobs **07/08** are out of scope (Bot Useful Agent Work).

Branch: `codex/s137-consumer-evidence-jobs-20260910` from master `1a23b648e3c5f90bc009accb85972e2db6e22051`.

Pack: `experiments/s137-consumer-evidence-jobs/`.

## Non-claims

- Offline deterministic transforms only (no paid endpoints, no legal attestation, no model-as-oracle tests).
- No invented facts; findings require citations.
- No claim of customer demand or banked revenue.
- S127 upgrade-impact remains a retained free assist; not relaunched or sold here.

## Concurrency / native Heavy

Admission plan: wave1 **16**, wave2 **+6**, wave3 **+9** (c32 reserved for parent integrate).

Measured peak (`receipts/concurrency/overlap-peak.json`):

- OS s137 sessions: **32** (exceeds S127 lower bound 28)
- Grok-related procs: **32**
- RSS sum: **3498 MB** (exceeds S127 lower bound 2811 MB)
- MemAvailable during peak sample: **~52.82%**

Native child capability (`receipts/concurrency/native-child-capability.json`):

- toolPresent: **True**; childrenStarted: **2**
- grandchildAllowed: **False**
- statedMax: **None** (host workflow cap 32 is a different tool)

## Verification

- `node --test` over pack tests: **126/126 pass**
- `node scripts/smoke-fixtures.mjs`: all six positive synthetic fixtures **decision=pass**
- CLI `analyze release-brief` / `analyze freshness-receipt` on synthetic positives: **pass**

Smoke ledger: `receipts/smoke/summary.json` (6 rows).

## Consumer surface

- CLI: `scripts/cli.mjs` (`list` | `analyze <artifact>` | `analyze --all`)
- Skill: `skills/consumer-evidence-jobs/SKILL.md`
- Shared packet: `src/packet.mjs`

Each artifact includes positive / negative / partial / conflict fixtures plus one real sourced example under `fixtures/real/<artifact>/` with PROVENANCE.
