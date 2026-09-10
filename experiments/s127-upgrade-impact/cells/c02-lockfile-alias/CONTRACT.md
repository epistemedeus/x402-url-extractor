# c02 lockfile / alias / workspace contract

Schema: `s127.upgrade-impact.lockfile.v1`

Public module: `experiments/s127-upgrade-impact/src/lockfile.mjs`

## What this cell decides

Resolve **caller-declared** dependency identity from `package.json` plus an
optional lockfile. Direct names only (not the nested graph).

A resolved identity is **not** an upgrade action (packet rule 1). This cell
never emits `action`, never fills `newVersion` / `resolvedNew`, and does not
invent paid demand.

| `decisionHint` | Meaning |
| --- | --- |
| `identity_resolved` | Registry-like name + locked version, range satisfied, no conflict |
| `unknown` | Missing/unsupported/conflict/workspace/non-registry/alias mismatch |

Packet rule 5: alias / workspace / lockfile disagreement → `unknown` plus a
structured `conflicts[]` row.

## API

```js
import {
  loadCallerLock,
  resolveCallerDependency,
  resolveDependency,
  listDisagreements,
  listDeclaredDependencies,
  toPacketDependencyOld,
  parseDependencySpec,
  rangeSatisfaction,
  detectLockfileKind,
} from "../../src/lockfile.mjs";

const result = resolveCallerDependency({
  manifestPath,          // package.json
  lockfilePath,          // optional; auto-detect sibling if exactly one JS lockfile
  name,                  // package.json key (alias key, not necessarily registry name)
  clock,                 // ISO; injector for replay
  evidenceClass,         // fixture | live-capture | synthetic
});
```

In-memory: `manifestText` / `lockfileText` skip filesystem reads.

## Result shape (success)

- `identity.requestedName` — key in package.json
- `identity.resolvedName` — alias target or same name
- `identity.resolvedVersion` — lockfile version when known
- `identity.protocol` — `registry | alias | workspace | file | git | url | …`
- `agreement` — `match | conflict | override | lockfile_missing | entry_missing | unsupported_format | unknown`
- `conflicts[]` — `{ kind, requested, locked, message }`
- `unknownReasons[]`
- `provenance[]` — `{ path, retrievedAt, contentSha256, coverage, label }`
- `lockfile.kind` / `formatSupport`

`toPacketDependencyOld(result)` fills packet `dependency.name` /
`oldVersion` / `resolvedOld` only. `newVersion` stays null (c04).

## Supported lockfiles

| Kind | Support |
| --- | --- |
| package-lock.json v1/v2/v3 | supported (JSON) |
| npm-shrinkwrap.json | supported |
| pnpm-lock.yaml (importers + packages; v6/v9 subset) | supported YAML subset |
| yarn.lock v1 | supported |
| yarn.lock Berry (`__metadata`) | supported YAML subset |
| bun.lock | partial JSONC |
| bun.lockb, Cargo.lock, poetry.lock, composer.lock, Gemfile.lock | unsupported → unknown |

YAML subset does **not** implement anchors, merge keys, or full 1.2 tags.
Those limitations are recorded; identity stays unknown when the subset fails.

## Integrator notes

- c07 should treat `decisionHint: "unknown"` and any `conflicts[]` as unknown
  rules, not caller defects.
- c03/c05 should use `identity.resolvedName` (alias target), not the alias key.
- Workspace protocol: even when versions match, `identityStatus` is unknown
  for registry upgrade-impact.
- Multiple sibling lockfiles without `lockfilePath` → unknown.
- No network. Do not `npm install`.
