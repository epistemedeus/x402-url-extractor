# S153 consumer distribution gates

Pin: `fa6878de125cfdcfd77f4b47037c88667090d293`.
Branch: `codex/s153-consumer-distribution-gates-20260910`.
Writable: `experiments/s137-consumer-evidence-jobs/**`, `experiments/s153-consumer-distribution-gates/**`.

## Export surface

Kit: `experiments/s153-consumer-distribution-gates/kit/` (`type: module`).

| Export | Job | Schema ids |
| --- | --- | --- |
| `./migration-checklist` | 01 | `s137.migration-checklist.input.v1` / `s137.migration-checklist.output.v1` |
| `./release-brief` | 02 | `s137.release-brief.input.v1` / `s137.release-brief.brief.v1` |
| `./table-reconcile` | 03 | `s137.table-reconcile.input.v1` / `s137.table-reconcile.output.v1` |
| `./link-index` | 04 | `s137.link-index.input.v1` / `s137.link-index.output.v1` |
| `./replay-pack` | 05 | `s137.replay-pack.input.v1` / `s137.replay-pack.output.v1` |
| `./freshness-receipt` | 06 | `s137.freshness-receipt.input.v1` / `s137.freshness-receipt.v1` |
| `./packet` | shared | `s137.consumer-evidence.packet.v1` |
| `bin/consumer-evidence` | CLI | `analyze` / `list` |

Manifests: `kit/manifests/01.json`…`06.json`. Examples: `kit/examples/<artifact>/` copied from `fixtures/real/*` plus `LICENSE-PINS.md`. Archive: `node kit/scripts/build-archive.mjs` → `kit/dist/s137-consumer-evidence-kit.tgz` (excludes `receipts/`, `logs/`, transcripts).

Jobs **07/08** remain excluded (`COMPAT-07-08.md`, CLI `EXCLUDED_JOBS`, owned-jobs JSON).

Shared plumbing: `src/common/{hash,clock}.mjs`. Artifact schemas re-export `sha256Hex` / `isIsoClock` / `CLOCK_ISO` without changing public names.

## Gates

48 cells (`gates/c01`…`c48`) × 8 situations. Runner: `node experiments/s153-consumer-distribution-gates/scripts/run-gates.mjs`.

## Verification

- `find experiments/s137-consumer-evidence-jobs -name '*.test.mjs' | xargs node --test`: **217/217 pass**
- same set plus modules that register `node:test` (incl. shared helpers): **235/235 pass**
- broader `node:test` module sweep: **253/253 pass**
- `node experiments/s137-consumer-evidence-jobs/scripts/smoke-fixtures.mjs`: six positives **decision=pass**
- `node experiments/s153-consumer-distribution-gates/scripts/run-gates.mjs`: **48/48 pass**
- Clean unpack of `kit/dist/s137-consumer-evidence-kit.tgz` + literal README CLI on all six examples: **ok=true** (decisions: pass/partial/fail as cited; no invented pass)
- Archive contains README/manifests/examples/input.json; excludes receipts/logs/transcripts
- No publication, payment, overage, or network I/O

## Concurrency / capacity

Parent capacity sample (`receipts/capacity-sample.json`, `receipts/overlap-peak.json`):

- Target cells: **48**; accepted: **48** (no filler)
- Admission waves: 16 +6 +9 +9 +8 while prior cells stayed active; MemAvailable stayed ≥**25%** and disk free ≥**20%** at every admit (`reserve-wave*.json`)
- Peak concurrent OS `grok --cwd` sessions: **49** at **2026-09-10T12:02:17Z** (48 cells + integrator), from session-events start/end sweep
- Unique native session IDs recorded: **48** cell ends + integrator end (see control-plane `session-events.jsonl`)
- MemAvailable at peak admission: **51.46%** / **8240 MB**; disk free **83.27%**
- S137 lower bound remains **32** OS sessions / **3498 MB** RSS
- Native-child canary (S137): **childrenStarted=2**; do **not** equate 49 OS grok CLI processes with 49 native children
- Continuous RSS sampler only captured pre-wave baseline before interrupt; peak concurrency is from session timestamps, not tmux labels alone

## Non-claims

Offline only. No invented demand. No paid endpoints. No legal attestation.
