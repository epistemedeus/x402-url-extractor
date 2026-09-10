# c31 DONE

Cell: unified CLI + SKILL wiring for R2-CONSUMER-JOBS-01..06.

## Summary

Offline CLI `scripts/cli.mjs` with subcommands `analyze <artifact> | analyze --all | list | --help`. It emits `s137.consumer-evidence.packet.v1` (or catalog/family envelopes) JSON to stdout and optionally `--out`. Skill `skills/consumer-evidence-jobs/SKILL.md` tells an agent when to run this versus a raw fetch, what to pass, what to read back, and the kill condition. The skill is **not published**.

The CLI loads sibling `src/<artifact>/{schema,transform}.mjs` when present. Missing or throwing modules do not crash the process: the packet is still valid, those stages are `unknown`/`partial`, and every finding carries `citationIds` into `citations[]`.

Jobs 07/08 are refused. No network I/O. `--live-capture` is recorded and still does not fetch. No npm lifecycle, no payment, no daemon, no default-branch merge. Assignment spend $0; do not invent paid demand. `--clock` is required for analyze (not invented).

Isolation fixtures under this cell are **synthetic**. The one real sourced example is the local pack file `docs/OWNED-JOBS-01-06.json` (hash cited by `list`; PROVENANCE in this cell). It is **fixture**, not live-capture.

## Files written

### CLI / skill (owned pack paths)
- `experiments/s137-consumer-evidence-jobs/scripts/cli.mjs`
- `experiments/s137-consumer-evidence-jobs/skills/consumer-evidence-jobs/SKILL.md`

### Isolation tests and fixtures (cell-local)
- `experiments/s137-consumer-evidence-jobs/cells/c31/test/cli.test.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c31/test/helpers.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/stub-src/migration-checklist/schema.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/stub-src/migration-checklist/transform.mjs`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/synthetic/positive.json`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/synthetic/negative.json`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/synthetic/partial.json`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/synthetic/conflict.json`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/empty-src/.keep`
- `experiments/s137-consumer-evidence-jobs/cells/c31/fixtures/real/PROVENANCE.json`
- `experiments/s137-consumer-evidence-jobs/cells/c31/DONE.md`

## Test command

From repo root (Node 20+; no `npm install`):

```bash
node --test experiments/s137-consumer-evidence-jobs/cells/c31/test/*.test.mjs
```

Result this VM: 21 pass / 0 fail (2026-09-10).

## Limitations

- This cell does not implement the six job transforms; it wires siblings. Missing `src/<artifact>/*.mjs` stays **unknown/partial**.
- `--clock` is required; the CLI does not invent operator time.
- `--live-capture` does not fetch in this CLI. There is no acquire module in this pack for the CLI to delegate to.
- Isolation stub transform/schema under `cells/c31/fixtures/stub-src/` are **synthetic** and are not the pack schema/transform cells.
- `docs/OWNED-JOBS-01-06.json` PROVENANCE `retrievedAt` is the operator clock used when hashing the local file, not a source-update time and not a live download time.
- `--in` URLs are refused (offline default).
- Uncited transform findings are dropped.
- Jobs 07/08 are out of scope.

## evidenceClass

`synthetic` for isolation CLI fixtures; `fixture` for the local OWNED-JOBS catalog hash (not live-capture).
