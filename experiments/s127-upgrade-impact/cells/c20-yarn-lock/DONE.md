# c20-yarn-lock DONE

Cell: `c20-yarn-lock`  
Schema: `s127.c20.yarn-lock.parse.v1` / `s127.c20.yarn-lock.resolve.v1` / `s127.c20.yarn-lock.overlay.v1`  
Owned path only: `experiments/s127-upgrade-impact/cells/c20-yarn-lock/`

## Outputs

Classic Yarn v1 `yarn.lock` resolver (Node built-ins; no vendored `@yarnpkg/lockfile`, no `js-yaml`).

| Input | Result |
| --- | --- |
| Classic v1, unique version for `name` | `status: resolved`, `dependency.resolvedOld` set |
| Classic v1, several ranges, **same** version | resolved (not a conflict) |
| Classic v1, **two versions** of the same name | `unknown` + `lockfile_version_conflict` (not first-wins) |
| `npm:` alias, unique target/version | resolved; alias **reported** |
| Alias target ≠ resolved tarball name | `unknown` + `alias_resolved_name_mismatch` |
| Yarn Berry (`__metadata` / `resolution:` / generated comment) | `format: berry`, `coverage: unknown`, no invented entries |
| Berry `workspace:` | unknown (unsupported) |
| Git conflict markers, unclosed quote, NUL, empty | unknown |
| Symlink lockfile path | refused (`symlink_refused`) |

Packet overlay (`resolveLockfile` / `resolveDependency` / `run`) matches integrator stage names in `scripts/lib/load-src.mjs`.

- Unique resolve → `dependency.resolvedOld`; **does not copy** declared `newVersion` into `resolvedNew`
- Optional second lockfile (`newLockfilePath` / `newLockfileText`) may fill `resolvedNew`
- Conflict / berry / missing → `lockfile.disagreement` and/or `summary.unknownReasons`; **never `action`**
- Provenance rows labeled `fixture` \| `live-capture` \| `synthetic`; clock never invented (`retrievedAt` omitted if no clock)

### Fixture vs live-capture

**All fixtures are synthetic / evidenceClass `fixture`.** Not live-capture. Not registry tarballs. No paid demand. `retrievedAt` on fixture bytes is the synthetic clock `2026-09-10T12:00:00.000Z` in overlay tests only; `fixtures/PROVENANCE.json` has `liveCapture: false`, `url: null`.

Required cases:

- Alias: `fixtures/classic-alias/` → `widget@npm:demo-widget@^1.0.0` resolves **1.2.3**
- Conflict: `fixtures/classic-conflict/` → `lodash` versions **3.10.1** and **4.17.21** → unknown

### Tests

```
node --test cells/c20-yarn-lock/test/*.test.mjs
```

**42 passed**, 0 failed (2026-09-10, local Node, offline).

## Isolation self-check

`isolationSelfCheck()`:

- `ok: true`
- `spawn: none` (no `node:child_process` in cell implementation)
- `network: none` (no `http`/`https`/`net`/`fetch`)
- `packageLifecycle: never`
- `paidDemand: false`
- Writes/reads stay under `cells/c20-yarn-lock/`
- Symlinks are not followed (`lstat` only)
- Test files may import `node:child_process` to prove the implementation does not spawn

## Limitations

- Classic yarn.lock v1 indent grammar only. **Yarn Berry (v2+) is unsupported → unknown.** Do not feed berry into the classic parser (`version:` YAML would look like a value).
- Not a YAML library. Not `@yarnpkg/lockfile` / `@yarnpkg/parsers`.
- Does not execute `yarn`/`npm`/`pnpm`, lifecycle scripts, or registry fetches.
- Does not parse TypeScript or JS exports (N/A for this cell).
- `file:` / `link:` locators report the lockfile `version` string; they are not registry resolutions.
- `workspace:` is berry; unknown.
- Multiple descriptors of the **same** version are not a conflict; multiple **distinct** versions are.
- A resolved alias is not disagreement. Disagreement is target/URL mismatch or multiple targets/versions.
- `resolvedNew` is unknown unless a second lockfile is supplied.
- A newer version alone is not a break. Unused export change is not a caller defect (binder rules; this cell does not bind exports).
- Missing/conflicting/partial lockfile stays **unknown**, not `action`.
- `__proto__` descriptors are dropped as hostile keys.
- 8 MiB / 200k line / 80k entry caps.

## Integrator notes

1. Merge via `resolveLockfile(ctx)` into `src/lockfile.mjs` (or dispatch yarn paths here). Do **not** treat this cell as `src/` — integrator owns that merge.
2. **Do not first-version-win.** `cells/c14-hostile/lockfile-conflict.mjs` `parseYarnLock` keeps the first version per name; `classic-conflict` would incorrectly resolve `lodash` to `3.10.1`. This cell keeps both and returns unknown.
3. Detect berry **before** classic parse. Berry stays unknown until a berry parser exists (c13 listed `@yarnpkg/parsers` BSD-2-Clause + `js-yaml`; not vendored here).
4. Packet flags this overlay already sets for rule 5: `lockfile.disagreement`, `lockfile.conflicts[]`, `dependency.lockfileDisagreement`, `dependency.aliasDisagreement`, `summary.unknownReasons` including `lockfile_alias_or_workspace_disagreement` when applicable.
5. Unique npm alias: report `lockfile.aliases[]` and still set `resolvedOld`. Do not force unknown solely because an alias exists.
6. Evidence labels: fixture \| live-capture \| synthetic. This cell produced **synthetic fixtures only**.
7. No S124/S125 trees touched. No default-branch merge. No daemon, accounts, payments, or posting.

## Exact files written

All under `experiments/s127-upgrade-impact/cells/c20-yarn-lock/`:

```
DONE.md
index.mjs
isolation.mjs
overlay.mjs
parse.mjs
resolve.mjs
fixtures/PROVENANCE.json
fixtures/berry-v6/yarn.lock
fixtures/berry-workspace/yarn.lock
fixtures/classic-alias-mismatch/package.json
fixtures/classic-alias-mismatch/yarn.lock
fixtures/classic-alias/expect.json
fixtures/classic-alias/package.json
fixtures/classic-alias/yarn.lock
fixtures/classic-bom-crlf/yarn.lock
fixtures/classic-conflict/expect.json
fixtures/classic-conflict/package.json
fixtures/classic-conflict/yarn.lock
fixtures/classic-file-workspace/package.json
fixtures/classic-file-workspace/yarn.lock
fixtures/classic-scoped-alias/yarn.lock
fixtures/classic-scoped-multikey/yarn.lock
fixtures/classic-simple/package.json
fixtures/classic-simple/yarn.lock
fixtures/empty/yarn.lock
fixtures/hostile-conflict-markers/yarn.lock
fixtures/hostile-unclosed-quote/yarn.lock
test/isolation.test.mjs
test/overlay.test.mjs
test/parse.test.mjs
test/resolve.test.mjs
```
