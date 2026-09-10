# c02-lockfile-alias DONE

Cell: `c02-lockfile-alias`  
Schema: `s127.upgrade-impact.lockfile.v1`  
Clock used in tests: `2026-09-10T00:00:00.000Z`  
Evidence class: **synthetic** (hand-written lockfile excerpts). Not live-capture. No registry fetch, no `npm install`, no paid demand.

## Summary

Resolves caller **dependency identity** from `package.json` plus an optional lockfile, offline, for **direct declared names only**.

- `npm:pkg@version` aliases map the package.json key to the lockfile’s real name + version.
- `workspace:` is reported (linked path + workspace version when present) and stays **unknown** for registry upgrade-impact.
- Lockfile version that does not satisfy the manifest range (or alias target name mismatch) is a **structured conflict** → `decisionHint: "unknown"` (packet rule 5).
- A resolved identity is **not** an upgrade action (packet rule 1). This cell never emits `action`, `newVersion`, or payment fields.
- Unsupported lockfile formats (Cargo.lock, bun.lockb, …) are unknown, not guessed.

Isolation tests: **28 passed** (`node --test cells/c02-lockfile-alias/test/lockfile.test.mjs`).

## Files written

### Implementation
- `experiments/s127-upgrade-impact/src/lockfile.mjs`

### Cell
- `experiments/s127-upgrade-impact/cells/c02-lockfile-alias/DONE.md` (this file)
- `experiments/s127-upgrade-impact/cells/c02-lockfile-alias/README.md`
- `experiments/s127-upgrade-impact/cells/c02-lockfile-alias/CONTRACT.md`
- `experiments/s127-upgrade-impact/cells/c02-lockfile-alias/PROVENANCE.json`
- `experiments/s127-upgrade-impact/cells/c02-lockfile-alias/exercise.mjs`
- `experiments/s127-upgrade-impact/cells/c02-lockfile-alias/test/lockfile.test.mjs`
- `experiments/s127-upgrade-impact/cells/c02-lockfile-alias/fixtures/README.md`

### Synthetic fixtures (label: synthetic)

| Path | Contract |
| --- | --- |
| `fixtures/alias-npm-v3/` | required: npm alias match |
| `fixtures/disagreement-range-npm-v3/` | required: lockfile vs manifest range conflict |
| `fixtures/alias-target-mismatch-npm-v3/` | alias target ≠ lock `name` |
| `fixtures/workspace-npm-v3/` | `workspace:*` + npm `link` |
| `fixtures/alias-pnpm-v9/` | pnpm-lock.yaml v9 alias |
| `fixtures/disagreement-pnpm-v9/` | pnpm range disagreement |
| `fixtures/pnpm-v6-alias/` | pnpm v6 `/name@version` keys |
| `fixtures/alias-yarn-v1/` | yarn.lock v1 alias |
| `fixtures/alias-yarn-berry/` | Yarn Berry `resolution` alias |
| `fixtures/exact-npm-v3/` | exact pin + devDep |
| `fixtures/shrinkwrap-alias/` | npm-shrinkwrap.json |
| `fixtures/npm-v1-dependencies/` | lockfileVersion 1 tree |
| `fixtures/scoped-npm-v3/` | `@scope/pkg` |
| `fixtures/override-npm-v3/` | `overrides` explaining a range miss |
| `fixtures/file-protocol/` | `file:` → non-registry unknown |
| `fixtures/missing-lockfile/` | no lockfile |
| `fixtures/unsupported-cargo/` | Cargo.lock unsupported |
| `fixtures/multiple-lockfiles/` | two lockfiles, unspecified path |
| `fixtures/hostile-proto/` | `__proto__` key ignored |

No writes under S124/S125 trees, pack `fixtures/synthetic/` (c10), or default branch.

## How to exercise

From repo root `/tmp/s127/x402-url-extractor`:

```bash
node --test experiments/s127-upgrade-impact/cells/c02-lockfile-alias/test/lockfile.test.mjs

node experiments/s127-upgrade-impact/cells/c02-lockfile-alias/exercise.mjs \
  experiments/s127-upgrade-impact/cells/c02-lockfile-alias/fixtures/alias-npm-v3/package.json \
  my-lodash

node experiments/s127-upgrade-impact/cells/c02-lockfile-alias/exercise.mjs \
  experiments/s127-upgrade-impact/cells/c02-lockfile-alias/fixtures/disagreement-range-npm-v3/package.json \
  left-pad
```

Expected:

- alias fixture: `identityStatus: "resolved"`, `resolvedName: "lodash"`, `resolvedVersion: "4.17.21"`, `decisionHint: "identity_resolved"`
- disagreement fixture: `agreement: "conflict"`, `conflicts[0].kind: "range_unsatisfied"`, `decisionHint: "unknown"`

Public API (integrator): `loadCallerLock`, `resolveCallerDependency`, `resolveDependency`, `listDisagreements`, `listDeclaredDependencies`, `toPacketDependencyOld`, `parseDependencySpec`, `rangeSatisfaction`. See `CONTRACT.md`.

## Limitations

- Direct declared dependencies only. Nested `node_modules/a/node_modules/b` is not a caller import surface.
- Semver checker is conservative: prerelease versions, dist-tags (`latest`), and unparsed ranges → `unknown`, not unsatisfied.
- pnpm/yarn Berry use a **YAML subset** (indent maps, flow `{ }`, quoted keys). Anchors, merge keys, `|`/`>` blocks, tags are not full YAML 1.2.
- bun.lock is partial JSONC; bun.lockb / Cargo.lock / poetry.lock / composer.lock / Gemfile.lock are unsupported → unknown.
- Yarn `patch:`, pnpm `catalog:`, `jsr:`, git/url/`file:`/`link:`/`portal:` are non-registry → unknown.
- Nested npm `overrides` (`a>b`) are recorded as a limitation and not applied.
- Multiple sibling lockfiles without `lockfilePath` → unknown (do not guess the package manager).
- Default importer is `.` (pnpm `importers["."]`, npm packages root). Other workspace importers are not auto-selected.
- Symlinks and files over 8 MiB are refused.
- Integrity / resolved URL strings in fixtures are placeholders, not registry evidence.
- `toPacketDependencyOld` never fills `newVersion` / `resolvedNew` (that is c04).

## Open questions for integrator

1. Map `decisionHint: "identity_resolved"` to packet bindings as identity only — do **not** treat it as `action`. Combine with c03/c05 before any next-action.
2. Use `identity.resolvedName` (alias target) as `dependency.name` for export-diff, not the alias key.
3. Workspace matches: should `resolvedOld` be the workspace package version, a `link:` path, or omitted? Cell reports both version and `linkedPath` and keeps `unknown`.
4. Monorepo: pass `importer` / `lockfilePath` per package, or should c01 normalize a workspace root first?
5. `spec_mismatch` (package.json specifier ≠ lockfile recorded specifier) is a conflict even if the locked version satisfies both. Confirm that with c07.
6. Overrides that pin a version outside the declared range are `agreement: "override"` + unknown. Should a later rule treat a matching override as identity_resolved?
7. c10 may want copies of these synthetic fixtures under pack `fixtures/synthetic/`; this cell did not write there.

## Negative / kill-adjacent notes

This cell does not claim paid demand. It only makes lockfile identity checkable so a later binding can beat “a newer version exists”. If real cases A/B never use aliases/workspaces and always have a single agreeing lockfile, this layer is still required as a **guard** (rule 5) rather than a paid differentiator.
