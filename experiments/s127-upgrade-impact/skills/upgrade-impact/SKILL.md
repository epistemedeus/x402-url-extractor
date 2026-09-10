---
name: upgrade-impact
description: >
  Bind an upstream package export/API change to the caller's actually used
  import surface and emit a replayable s127.upgrade-impact.packet.v1
  (action | unknown | no_action). Use when asked whether a dependency upgrade
  affects this repo, which used exports changed, whether to bump a pin, or
  whether an unused API change is a caller defect. Prefer this CLI over a raw
  registry/changelog fetch when the question is caller-specific. Use when the
  user runs /upgrade-impact. Offline default. Do not publish.
---

# Upgrade impact

Run the pack CLI. Do not guess from registry "latest" alone. Do not publish this skill or the packet as a paid job from here.

## When to run this vs raw registry fetch

Raw `GET https://registry.npmjs.org/<pkg>` (or changelog skim) answers "a newer version exists." That is not upgrade impact.

Run this CLI when the operator question is: **does old → new of this dependency change exports this caller actually imports?**

| Situation | Tool |
| --- | --- |
| What is latest? / what changed in the changelog? | Registry fetch + changelog. Not this skill. |
| Does this caller use a removed/renamed/signature-changed export? | This CLI (`analyze`). |
| Re-run the same inputs after a second snapshot | `replay` |
| Operator correction without mutating the prior packet | `correct` |
| Binding adds no decision beyond registry+changelog on real cases A/B | **Stop.** Kill condition below. |

A new version is not itself a break. An unused export change is not a caller defect. Missing or conflicting source stays `unknown`, not `action`.

## How to run

Pack root: `experiments/s127-upgrade-impact`. Node 20+. No `npm install`. Offline default (no network unless a later acquire module honors `--live-capture`; this skill still prefers fixtures).

```bash
node experiments/s127-upgrade-impact/scripts/cli.mjs --help

node experiments/s127-upgrade-impact/scripts/cli.mjs analyze \
  --manifest <package.json> \
  --lockfile <yarn.lock|package-lock.json|pnpm-lock.yaml> \
  --source-root <dir> \
  --dep <name> --old <ver> --new <ver> \
  --fixture-old <extracted-or-snapshot> \
  --fixture-new <extracted-or-snapshot> \
  --clock <operator-ISO-8601> \
  --out <packet.json>
```

`--source-root` is repeatable. `--clock` is required (do not invent it). `--prior` is required for `replay` and `correct`. Packet JSON goes to stdout and to `--out` when set. Never pass `--out` equal to `--prior` (priors are immutable).

Label every artifact `fixture` | `live-capture` | `synthetic`. This pack's isolation files under `cells/c09-cli-packaging/fixtures/` are **synthetic** / local **fixture**, not live-capture.

## Inputs

Required for `analyze`: `--dep` `--old` `--new` `--clock`.

Optional: `--manifest` `--lockfile` `--source-root` `--fixture-old` `--fixture-new` `--out` `--prior` `--evidence-class` `--live-capture` `--compact`.

Do not run lifecycle scripts from tarballs. Extract with `tar` only. If parser deps are ever installed, `--ignore-scripts` only; prefer Node built-ins.

## Outputs

Schema `s127.upgrade-impact.packet.v1`. Trust `summary.nextAction`:

- `action` — at least one **used** export binding with a real change
- `no_action` — same version, or only unused export changes, or a completed no-op
- `unknown` — missing modules, dynamic import, lockfile/alias disagreement, partial source, TS-only surface

Also read `bindings[]`, `unknownReasons[]`, `unusedChanges[]`, `actionableChanges[]`, `limitations[]`, `provenance[]`. `execute` stays false. `payment.attempted` stays false. Assignment spend is $0; do not invent paid demand.

## Kill condition

If binding never changes the decision relative to "read registry + changelog" on real cases A/B, record negative evidence and **stop packaging as a paid job**. Do not publish. Do not open accounts, post, pay, start a daemon, or merge to default.

## Missing siblings

`src/*.mjs` are owned by other cells. If they are missing, the CLI still emits a valid packet with those stages `unknown`. Do not treat that packet as a break.
