# c01-normalize DONE

Cell: `c01-normalize`  
Schema produced: `s127.upgrade-impact.input.v1` (feeds packet `s127.upgrade-impact.packet.v1`)  
Label: **fixture** / synthetic. Not live-capture. No paid demand invented.

## Summary

`src/normalize.mjs` turns caller JSON (CLI flags or nested packet-shaped objects) into a stable internal shape:

- confined `package.json` / lockfile / source-root paths
- target dependency name
- old/new versions or range
- operator clock

It never executes files (no import of caller sources, no npm, no lifecycle scripts). Path escapes, URLs, home/env expansion, UNC, and symlinks are **invalid**. Missing/unreadable paths are **unknown**. Failures are JSON Schema-ish issue objects (`kind`, `code`, `keyword`, `instancePath`, `schemaPath`, `message`, `params`) — `normalizeCallerInput` does not throw.

A newer version is accepted as input and is **not** classified as a break here. Same old/new version is valid input (later cells emit `no_action`). Unused export changes are out of scope.

## Files written

| Path | Role |
| --- | --- |
| `src/normalize.mjs` | Implementation + stdin/`--self-check` entry |
| `cells/c01-normalize/normalize.test.mjs` | node:test contract (33 tests) |
| `cells/c01-normalize/fixtures/PROVENANCE.json` | fixture vs live-capture label |
| `cells/c01-normalize/fixtures/input-ok.json` | stdin exercise document |
| `cells/c01-normalize/fixtures/caller-ok/package.json` | synthetic caller manifest (lifecycle scripts exist only as a no-exec trap) |
| `cells/c01-normalize/fixtures/caller-ok/package-lock.json` | synthetic lockfile path (contents not parsed) |
| `cells/c01-normalize/fixtures/caller-ok/src/index.mjs` | synthetic source root (never imported) |
| `cells/c01-normalize/DONE.md` | this file |

## How to exercise

From pack root `experiments/s127-upgrade-impact`:

```bash
node --test cells/c01-normalize/normalize.test.mjs
node src/normalize.mjs --self-check
node src/normalize.mjs < cells/c01-normalize/fixtures/input-ok.json
```

Integrator call:

```js
import { normalizeCallerInput } from "./src/normalize.mjs";

const result = normalizeCallerInput(raw, { workspaceRoot });
// result.ok / result.status: "ok" | "invalid" | "unknown"
// result.caller.{manifestPath, lockfilePath, sourceRoots, evidenceClass, workspaceRoot}
// result.dependency.{name, oldVersion, newVersion, range, resolvedOld, resolvedNew}
// result.issues[]  JSON Schema-ish
```

Relative paths resolve against `workspaceRoot` (option, else input, else `process.cwd()`). `options.workspaceRoot` is the jail and wins over a nested value; an escaping nested `workspaceRoot` is invalid.

Accepted aliases (conflict if two present and differ):

- name: `dependency.name`, `name`, `package`, `pin.package`, `operator.pin.package`
- old: `dependency.oldVersion`, `from`, `currentVersion`, `pin` string, `pin.version`
- new: `dependency.newVersion`, `to`, `targetVersion`
- range: `dependency.range`, `versionRange`
- manifest: `caller.manifestPath`, `packageJsonPath`, `package.json`
- lockfile: `caller.lockfilePath`, `lockfile`
- source roots: `caller.sourceRoots`, `sourceRoot`, `src`
- clock: `clock`, `operatorClock` (ISO-8601 with `Z` or numeric offset; `"now"` refused)
- evidence: `fixture` \| `live-capture` \| `synthetic` \| `owner-qa` (`live-replay` maps to `live-capture`)

Exact semver (optional `v` prefix) fills `resolvedOld`/`resolvedNew` as **operator-exact**. Ranges, dist-tags, and `file:`/`workspace:`/`git:` stay unresolved (`lockfileConsulted: false`). Protocol specifiers are not opened.

## Limitations

- Does not parse lockfiles (c02) or static imports (c03).
- Does not resolve dist-tags/ranges against a registry. Range detection is heuristic, not a full npm semver library.
- Does not read `package.json` body to confirm the named dependency is listed.
- Does not follow or accept symlinks (`lstat` only).
- Does not invent operator clock or paid demand. `execute`/`executed`/`paidDemand` stay false.
- TypeScript and dynamic `import()` surfaces are unknown here.
- Default `evidenceClass=fixture` and default `manifestPath=package.json` / `sourceRoots=[manifestDir]` are recorded in `defaultsApplied`.
- Path jail is POSIX/`path.resolve` based (this pack is Linux). Unicode normalization / Windows drive letters are not modeled.
- TOCTOU: later cells must re-check paths; this cell only snapshots `lstat` at normalize time.
- Module `--json <file>` is refused (stdin only). File-path CLI belongs to c09.

## Open questions for integrator (c09 / c02 / c06)

1. Keep default `sourceRoots = dirname(manifest)` or require explicit roots?
2. Should omitted lockfile stay omitted, or should c02 search `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` and report disagreement as unknown?
3. Dist-tag `latest` as `newVersion`: currently ok + unresolved. Prefer invalid at CLI?
4. Packet `caller.manifestPath`: this cell emits **absolute confined** paths plus `*Relative` POSIX fields. Which should the packet store?
5. `status=unknown` (missing file) still includes confined paths and `partial: true`. Should c09 stop, or pass through to c02/c03 with coverage holes?
6. Keep S122-shaped `pin: { package, version }` aliases?
7. Conservative npm names (lowercase only). Allow capitals as unknown instead of invalid?
8. Should c01 verify the dependency name appears in `package.json` dependencies, or is that c02?

## Self-check result

`node --test cells/c01-normalize/normalize.test.mjs`: **33 pass, 0 fail** (including no-exec sentinel, path-escape, symlink refuse, missing=unknown, stdin JSON CLI).
