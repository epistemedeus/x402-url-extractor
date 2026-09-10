# S127 upgrade-impact

Offline experiment: bind an upstream package **export/API change** to a
caller's **actually used** imports and emit a replayable
`s127.upgrade-impact.packet.v1` decision (`action | unknown | no_action`).

Parent: S122 useful application jobs. Does **not** modify S124 marketplace or
S125 Pulse packages. Does not touch merchant payment APIs.

## Quick start

```bash
node experiments/s127-upgrade-impact/scripts/cli.mjs --help

node experiments/s127-upgrade-impact/scripts/cli.mjs analyze \
  --dep demo-widget --old 1.0.0 --new 2.0.0 \
  --clock 2026-09-10T12:00:00.000Z \
  --manifest experiments/s127-upgrade-impact/fixtures/synthetic/callers/removed-export-used/package.json \
  --lockfile experiments/s127-upgrade-impact/fixtures/synthetic/callers/removed-export-used/package-lock.json \
  --source-root experiments/s127-upgrade-impact/fixtures/synthetic/callers/removed-export-used/src \
  --fixture-old experiments/s127-upgrade-impact/fixtures/synthetic/packages/demo-widget/1.0.0 \
  --fixture-new experiments/s127-upgrade-impact/fixtures/synthetic/packages/demo-widget/2.0.0-removed-alpha \
  --evidence-class synthetic
```

Skill entry: `skills/upgrade-impact/SKILL.md`.

## Rules

- A newer version alone is not a break.
- An unused export change is not a caller defect.
- Missing/partial/conflicting source, dynamic import, or lockfile/alias
  disagreement ⇒ `unknown`, not `action`.
- Never run untrusted package lifecycle scripts; fixture trees are directories.

## Stage-1 kill condition

If usage-binding never changes the **coarse** operator move vs registry +
changelog skim on real cases A/B, stop packaging as a paid job. See
`RESULT.md` and `cells/c22-kill-harness/`. On 2026-09-10 real A/B majors the
suite verdict was **kill** (honest negative evidence). Residual code remains
useful as a free agent assist that names used exports.

## Tests

```bash
cd experiments/s127-upgrade-impact && node --test test/*.test.mjs
cd cells/c22-kill-harness && node --test test/*.test.mjs
node cells/c15-cold-a/run.mjs
node cells/c16-cold-b/run.mjs
```
