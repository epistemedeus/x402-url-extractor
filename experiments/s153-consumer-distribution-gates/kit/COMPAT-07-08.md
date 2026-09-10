# Compatibility: R2-CONSUMER-JOBS-07/08

Pin: `fa6878de125cfdcfd77f4b47037c88667090d293`.

Jobs **07** and **08** are owned elsewhere (Bot Useful Agent Work). This kit does not implement, export, or CLI-wire them.

## Exclusion wiring (kept)

- `docs/OWNED-JOBS-01-06.json` `excludedJobs`: `R2-CONSUMER-JOBS-07`, `R2-CONSUMER-JOBS-08`.
- CLI `EXCLUDED_JOBS` and `isExcludedJob()` refuse tokens `07`, `08`, `R2-CONSUMER-JOBS-07`, `R2-CONSUMER-JOBS-08` (usage exit 2, "out of scope").
- Skill and pack RESULT.md state jobs 07/08 are out of scope.
- Kit `src/index.mjs` exports `EXCLUDED_JOBS` with the same two ids.
- Every `manifests/0N.json` repeats `excludedJobs`.

## Stable export surface (jobs 01–06 only)

Package exports (see `package.json`):

| Export | Artifact | Schema ids |
| --- | --- | --- |
| `./migration-checklist` | R2-CONSUMER-JOBS-01 | `s137.migration-checklist.input.v1` / `s137.migration-checklist.output.v1` |
| `./release-brief` | R2-CONSUMER-JOBS-02 | `s137.release-brief.input.v1` / `s137.release-brief.brief.v1` |
| `./table-reconcile` | R2-CONSUMER-JOBS-03 | `s137.table-reconcile.input.v1` / `s137.table-reconcile.output.v1` |
| `./link-index` | R2-CONSUMER-JOBS-04 | `s137.link-index.input.v1` / `s137.link-index.output.v1` |
| `./replay-pack` | R2-CONSUMER-JOBS-05 | `s137.replay-pack.input.v1` / `s137.replay-pack.output.v1` |
| `./freshness-receipt` | R2-CONSUMER-JOBS-06 | `s137.freshness-receipt.input.v1` / `s137.freshness-receipt.v1` |
| `./packet` | shared envelope | `s137.consumer-evidence.packet.v1` |
| `./cli` | bin | `analyze <artifact>` / `list` |

There is no `./07`, `./08`, or CLI artifact token for those jobs. Adding them here would overlap another owner.

Shared helpers (`sha256Hex` / `isIsoClock`) live in `src/common/` and are re-exported from artifact schemas without changing public names.
