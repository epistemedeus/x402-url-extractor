# c09-cli-packaging DONE

Cell: CLI + SKILL entry for S127 upgrade-impact.

## Summary

Offline CLI `scripts/cli.mjs` with subcommands `analyze | replay | correct | --help`. It emits `s127.upgrade-impact.packet.v1` JSON to stdout and optionally `--out`. Skill `skills/upgrade-impact/SKILL.md` tells an agent when to run this versus a raw registry/changelog fetch, what to pass, what to read back, and the kill condition. The skill is **not published**.

The CLI loads sibling `src/*.mjs` when present (normalize, lockfile, acquire, imports, export-diff, bind, unknown, prior) through adapters. Missing or throwing modules do not crash the process: the packet is still valid, those stages are `unknown`, and the PACKET-CONTRACT safety net still applies:

- a newer version alone is not a break (`action` is refused without a used-export binding)
- unused export change is not a caller defect
- same declared version is `no_action`
- dynamic import of the package surface is `unknown`
- lockfile/alias disagreement is `unknown`

No network I/O in this cell. `--live-capture` is forwarded to acquire if that module exists; this CLI never `fetch`es. No npm lifecycle, no payment, no daemon, no default-branch merge. Assignment spend $0; do not invent paid demand.

Isolation fixtures under this cell are **synthetic** (local files). They are not live-capture.

## Files written

### CLI
- `experiments/s127-upgrade-impact/scripts/cli.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/args.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/adapters.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/contract.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/hash.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/io.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/load-src.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/packet.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/paths.mjs`
- `experiments/s127-upgrade-impact/scripts/lib/pipeline.mjs`

### Skill (unpublished)
- `experiments/s127-upgrade-impact/skills/upgrade-impact/SKILL.md`

### Isolation tests and fixtures (synthetic)
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/test/cli.test.mjs`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/test/packet-rules.test.mjs`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/test/helpers.mjs`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/manifest.json`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/old-exports.json`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/new-exports.json`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/source-root/index.js`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/empty-src/.keep`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/stub-src-used/bind.mjs`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/stub-src-unused/bind.mjs`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/fixtures/stub-src-dynamic/bind.mjs`
- `experiments/s127-upgrade-impact/cells/c09-cli-packaging/DONE.md`

## How to exercise

From pack root `experiments/s127-upgrade-impact` (Node 20+; no `npm install`):

```bash
node --test cells/c09-cli-packaging/test/*.test.mjs

node scripts/cli.mjs --help

node scripts/cli.mjs analyze \
  --manifest cells/c09-cli-packaging/fixtures/manifest.json \
  --source-root cells/c09-cli-packaging/fixtures/source-root \
  --dep demo-dep --old 1.0.0 --new 2.0.0 \
  --fixture-old cells/c09-cli-packaging/fixtures/old-exports.json \
  --fixture-new cells/c09-cli-packaging/fixtures/new-exports.json \
  --clock 2026-09-10T12:00:00.000Z

# Isolation (ignore pack src/ siblings):
S127_UPGRADE_IMPACT_SRC=cells/c09-cli-packaging/fixtures/empty-src \
  node scripts/cli.mjs analyze --dep demo-dep --old 1.0.0 --new 1.0.0 \
  --clock 2026-09-10T12:00:00.000Z
# → summary.nextAction = no_action

# Replay / correct (priors are immutable; --out must not equal --prior):
node scripts/cli.mjs analyze ... --out /tmp/s127-prior.json
node scripts/cli.mjs replay --prior /tmp/s127-prior.json --clock 2026-09-10T12:00:00.000Z --out /tmp/s127-replay.json
node scripts/cli.mjs correct --prior /tmp/s127-prior.json --clock 2026-09-10T12:00:00.000Z \
  --correction "second snapshot" --out /tmp/s127-corrected.json
```

Contract flags: `--manifest --lockfile --source-root` (repeatable) `--dep --old --new --fixture-old --fixture-new --clock --out`. Extra flags this cell needed: `--prior` (replay/correct), `--correction`, `--compact`, `--evidence-class`, `--live-capture`, `--src-root`.

Exit codes: `0` valid packet (including `unknown`/`no_action`), `1` unreadable required files or prior overwrite refused, `2` usage.

## Isolation test result

`node --test cells/c09-cli-packaging/test/*.test.mjs` → 26 pass / 0 fail (2026-09-10, this VM).

## Limitations

- This cell does not implement import/export analysis; it wires siblings. TS, type-only, and dynamic `import(expr)` stay **unknown** (sibling labels + CLI safety net).
- No runtime execution of untrusted packages or lifecycle scripts.
- `--clock` is required; the CLI does not invent operator time.
- `--live-capture` does not fetch in this CLI. Only `src/acquire.mjs` may, and only if that module is present.
- Isolation fixtures (`demo-dep` JSON export lists) are **synthetic**. They are not registry tarballs and not live-capture.
- c03 parser-vendor provenance (when `src/imports.mjs` runs) may carry `label: live-capture` for vendored es-module-lexer/meriyah snapshots owned by c03; that is sibling evidence, not a c09 live GET.
- Bind cell `nextAction` values `review_breakages` / `upgrade_with_edits` are stored as `summary.suggestedAction`. Contract `summary.nextAction` stays `action | unknown | no_action`.
- Workspace jail for normalize is `process.cwd()`.
- Packet `--out` is a packet JSON file, not necessarily c08 `prior.v1` with `payload` wrapping. Replay/correct accept either a packet file or a c08 prior artifact.
- `src/lockfile.mjs` appeared during this cell; adapter prefers `resolveCallerDependency`. If that API moves, update `scripts/lib/adapters.mjs`.

## Open questions for integrator

1. Should pack-level `summary.nextAction` keep bind's `review_breakages` / `upgrade_with_edits`, or stay on the three contract words (current: three words + `suggestedAction`)?
2. Should `analyze --out` also write a sequenced c08 `prior.v1` via `writeSequencedPrior`, or is packet JSON the prior for v1?
3. Is `--clock` allowed to default once normalize owns clock policy? Both this CLI and c01 refuse to invent it.
4. `S127_UPGRADE_IMPACT_SRC` / `--src-root` exist so c09 tests stay isolated from sibling progress. Keep them for c10/c15/c16?
5. c10 owns `test/` and `fixtures/synthetic/`. Move or duplicate these isolation tests there, or leave c09 as the CLI contract suite?
6. Acquire fixture catalog is c04's `s127-demo-lib`, not this cell's `demo-dep`. Cold consumers should use c04/c11/c12 fixtures for real export-diff roots.
7. Kill condition still needs real cases A/B (c11/c12): if binding never changes the decision versus registry+changelog, stop packaging as a paid job.

## Kill condition (from packet contract)

If binding never changes the decision relative to "read registry + changelog" on real cases A/B, record negative evidence and stop packaging as a paid job. Do not publish.
