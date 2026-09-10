# S137 concurrency graph (32 one-writer cells)

Owner scope: **R2-CONSUMER-JOBS-01..06 only**. Jobs 07/08 are out of bounds.

Native Heavy implements cells. Cursor admits OS `grok --prompt-file` sessions under memory gates.
Prior lower bound to beat: 28 OS sessions / ~2811 MiB RSS (S127). Do not count quiet TUIs, marker probes, or plain Node pools.

## Jobs → modules

| Job | Artifact | Module dir |
| --- | --- | --- |
| 01 | docs migration checklist | `src/migration-checklist/` |
| 02 | release evidence brief | `src/release-brief/` |
| 03 | source table reconciliation | `src/table-reconcile/` |
| 04 | link/artifact index | `src/link-index/` |
| 05 | official-example offline replay pack | `src/replay-pack/` |
| 06 | dataset freshness receipt | `src/freshness-receipt/` |

Shared (integrator): `src/packet.mjs`, `scripts/cli.mjs`, `skills/consumer-evidence-jobs/SKILL.md`, `test/e2e*.mjs`, `RESULT.md`.

## 32 cells (one-writer paths)

| ID | Owns (write) | Depends on |
| --- | --- | --- |
| c01 | `src/migration-checklist/schema.mjs` | — |
| c02 | `src/migration-checklist/transform.mjs` | c01 |
| c03 | `fixtures/synthetic/migration/` | — |
| c04 | `fixtures/real/migration/` + PROVENANCE | — |
| c05 | `test/migration-checklist.test.mjs` | c01–c04 |
| c06 | `src/release-brief/schema.mjs` | — |
| c07 | `src/release-brief/transform.mjs` | c06 |
| c08 | `fixtures/synthetic/release-brief/` | — |
| c09 | `fixtures/real/release-brief/` + PROVENANCE | — |
| c10 | `test/release-brief.test.mjs` | c06–c09 |
| c11 | `src/table-reconcile/schema.mjs` | — |
| c12 | `src/table-reconcile/transform.mjs` | c11 |
| c13 | `fixtures/synthetic/table-reconcile/` | — |
| c14 | `fixtures/real/table-reconcile/` + PROVENANCE | — |
| c15 | `test/table-reconcile.test.mjs` | c11–c14 |
| c16 | `src/link-index/schema.mjs` | — |
| c17 | `src/link-index/transform.mjs` | c16 |
| c18 | `fixtures/synthetic/link-index/` | — |
| c19 | `fixtures/real/link-index/` + PROVENANCE | — |
| c20 | `test/link-index.test.mjs` | c16–c19 |
| c21 | `src/replay-pack/schema.mjs` | — |
| c22 | `src/replay-pack/transform.mjs` | c21 |
| c23 | `fixtures/synthetic/replay-pack/` | — |
| c24 | `fixtures/real/replay-pack/` + PROVENANCE | — |
| c25 | `test/replay-pack.test.mjs` | c21–c24 |
| c26 | `src/freshness-receipt/schema.mjs` | — |
| c27 | `src/freshness-receipt/transform.mjs` | c26 |
| c28 | `fixtures/synthetic/freshness/` | — |
| c29 | `fixtures/real/freshness/` + PROVENANCE | — |
| c30 | `test/freshness-receipt.test.mjs` | c26–c29 |
| c31 | `scripts/cli.mjs`, `skills/consumer-evidence-jobs/SKILL.md` | schemas ready |
| c32 | `test/e2e-family.test.mjs`, `RESULT.md` integration notes | c01–c31 |

## Admission plan

1. Probe native child capability (1 session).
2. Admit **16** ready leaves (schemas + fixtures + early transforms): c01,c03,c04,c06,c08,c09,c11,c13,c14,c16,c18,c19,c21,c23,c24,c26.
3. While active, if MemAvailable ≥25% and PSI memory avg10≈0: admit **+6** then **+9** more useful cells (transforms/tests/cli), not padding.
4. Continue while reserve/throughput allows; stop when useful work complete.

Each cell MUST: positive/negative/partial/conflicting cases; one real sourced example with PROVENANCE; no invented facts; no paid endpoints; no legal attestation; no model-as-oracle tests.
