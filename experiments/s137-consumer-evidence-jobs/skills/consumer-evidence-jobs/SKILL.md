---
name: consumer-evidence-jobs
description: Run the offline S137 CLI that wires six cited consumer-evidence artifacts (migration checklist, release brief, table reconcile, link index, replay pack, freshness receipt) from operator-supplied local fixtures. Use when asked to produce those packets. Prefer this CLI over guessing. Offline default. Do not publish or pay.
---

# Consumer evidence jobs (01–06)

Run the pack CLI. Do not invent document, release, table, link, API, or freshness facts. Do not publish this skill or the packet as a paid job from here.

This skill covers **R2-CONSUMER-JOBS-01..06 only**. Jobs 07/08 are out of scope.

## When to run this vs a raw fetch

A live GET answers "a URL currently returns bytes." That is not a cited migration checklist, release brief, table merge, link index, replay pack, or freshness receipt.

| Situation | Tool |
| --- | --- |
| What is on a public URL right now? | Credential-free fetch, separately, with operator authorization. Not this skill's default. |
| Turn supplied old/new docs + caller ops into a cited migration checklist | `analyze migration-checklist` |
| Turn supplied commit/release inputs into a brief that keeps announced / shipped / tested separate | `analyze release-brief` |
| Merge supplied tables on explicit keys/units/windows; surface disagreement | `analyze table-reconcile` |
| Build a citation index from supplied HTML/Markdown (anchors, unreachable, duplicates) | `analyze link-index` |
| Package supplied official API examples as no-spend offline fixtures | `analyze replay-pack` |
| Describe retrieval age vs source update time from supplied evidence | `analyze freshness-receipt` |
| List the six wired jobs | `list` |

Missing or conflicting source stays `unknown` / `partial` / `conflict`, not `pass`. Do not fill gaps with a model.

## How to run

Pack root: `experiments/s137-consumer-evidence-jobs`. Node 20+. No `npm install`. Offline default (this CLI never `fetch`es; `--live-capture` is recorded and still does not hit the network).

```bash
node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs --help

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs list

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze migration-checklist \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/migration \
  --clock 2026-09-10T12:00:00.000Z \
  --out /tmp/s137-migration-packet.json

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze release-brief \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief \
  --clock 2026-09-10T12:00:00.000Z

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze table-reconcile \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/table-reconcile \
  --clock 2026-09-10T12:00:00.000Z

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze link-index \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/link-index \
  --clock 2026-09-10T12:00:00.000Z

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze replay-pack \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack \
  --clock 2026-09-10T12:00:00.000Z

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze freshness-receipt \
  --in experiments/s137-consumer-evidence-jobs/fixtures/synthetic/freshness \
  --clock 2026-09-10T12:00:00.000Z

node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze --all \
  --clock 2026-09-10T12:00:00.000Z \
  --in-root experiments/s137-consumer-evidence-jobs/fixtures/synthetic
```

`--clock` is required for `analyze` (do not invent it). Packet JSON goes to stdout and to `--out` when set. Never pass `--out` equal to `--in`. `--in` must be a local path; `http(s)://` is refused.

Label every artifact `synthetic` | `fixture` | `live-capture`. Prefer offline fixtures. This CLI defaults to `synthetic` unless `--evidence-class` is set or `--in` sits under `fixtures/real/` (`fixture`) or `fixtures/synthetic/` (`synthetic`).

## Transform contract (sibling modules)

Each job is owned by other cells. The CLI loads, when present:

- `src/<dir>/schema.mjs` — first of `validateInput` | `validate` | `assertInput`
- `src/<dir>/transform.mjs` — first of `transform` | `run` | `analyze` | `build`

Call shape: one `ctx` object:

`{ command, jobId, artifactKind, clock, evidenceClass, offline: true, liveCaptureRequested, inputPath, inputKind, input, inputText, sources, packRoot, srcRoot }`

Return `{ decision, findings, citations, limitations, artifact }` (or a packet overlay). Every finding must include `citationIds` into `citations[]` (path/url + sha256 when possible). Uncited findings are dropped.

If a sibling is missing, the CLI still emits a valid packet with that stage `unknown`/`partial`. Do not treat that packet as a completed checklist/brief/merge/index/pack/receipt.

## Outputs

Trust `decision`: `pass` | `fail` | `partial` | `conflict` | `unknown`.

Also read `findings[]`, `citations[]`, `limitations[]`, `modules`, `unknownReasons[]`, `artifact`. `execute` stays false. `posted` stays false. `payment.attempted` stays false. Assignment spend is $0; do not invent paid demand.

Evidence class is `synthetic` | `fixture` | `live-capture`. A `live-capture` label without a capture is `conflict` or `unknown`, not a successful live run.

## Kill condition

If a job never produces cited findings beyond echoing the input path, record negative evidence and **stop packaging as a paid job**. Do not publish. Do not open accounts, post, pay, start a daemon, or merge to default.

## Missing siblings

`src/<artifact>/*.mjs` are owned by other cells. If they are missing, the CLI still emits a valid packet with those stages `unknown`/`partial`. That is not a pass.
