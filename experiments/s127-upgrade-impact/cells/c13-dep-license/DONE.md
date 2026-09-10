# c13-dep-license DONE

## Summary

Audited parsers the upgrade-impact pack should reuse. **Do not add GPL/AGPL/LGPL.** Regex is not a TypeScript analyzer.

**Minimal integrator set (recommend):**

1. Node built-ins (`crypto`, `fs`, `path`, `url`, `zlib`, `JSON.parse`)
2. S122 local `semver.mjs` (exact `x.y.z`; ranges → `unknown`)
3. `es-module-lexer` **3.0.2** MIT, 0 deps — vendor or optionalDep, `--ignore-scripts`
4. `node:zlib` + small ustar reader, or host `tar` CLI — never `npm install` an acquired tarball

**Optional if the surface exists:** `cjs-module-lexer` 2.2.1 (CJS), **one of** acorn 8.18.0 **or** meriyah 7.3.3 (not both), `yaml` 2.9.0 (pnpm), `@yarnpkg/lockfile` 1.1.0 (Yarn classic), `jsonc-parser` 3.3.1 (tsconfig), `semver` 7.8.5 (ranges only).

**Rejected despite permissive SPDX:** `typescript`, `oxc-parser` (native farms), `@pnpm/lockfile-file` (19 deps), `tar@7` (size), `sucrase` (strip ≠ types).

**Rejected copyleft / trap:** tinymce (GPL-or-commercial), ckeditor4 LTS, gifsicle (MIT field + postinstall + GPL binary), synthetic `GPL-3.0-only` and `MIT AND AGPL-3.0-only`.

Live-capture of npm `/latest` + Unpkg LICENSE files at **2026-09-10T10:45:04Z**. No tarball lifecycle scripts, no `npm install`, $0, no paid demand.

Parallel cells c03/c05 independently vendored the same pins (`es-module-lexer@3.0.2` JS/asm, `cjs-module-lexer@2.2.1`, `meriyah@7.3.3`). Integrator should keep one vendor tree.

## Files written

Owned paths only: `cells/c13-dep-license/**` and `docs/LICENSES.md`.

- `docs/LICENSES.md`
- `cells/c13-dep-license/REUSE.md`
- `cells/c13-dep-license/README.md`
- `cells/c13-dep-license/DONE.md`
- `cells/c13-dep-license/policy.mjs`
- `cells/c13-dep-license/catalog.mjs`
- `cells/c13-dep-license/check.mjs`
- `cells/c13-dep-license/fixtures/catalog.json`
- `cells/c13-dep-license/fixtures/provenance.json`
- `cells/c13-dep-license/fixtures/local-semver.mjs`
- `cells/c13-dep-license/fixtures/naive-import-regex.mjs`
- `cells/c13-dep-license/fixtures/regex-false-positives.source.txt`
- `cells/c13-dep-license/fixtures/live-capture/` (packuments, slim index, LICENSE subset, sha256 index)
- `cells/c13-dep-license/test/*.test.mjs` (4 files)

Did not write `src/`, pack `package.json`, S124/S125 trees, or S122.

## How to exercise

From `experiments/s127-upgrade-impact` (Node 20+, no install):

```bash
node --test cells/c13-dep-license/test/*.test.mjs
node cells/c13-dep-license/check.mjs
node cells/c13-dep-license/check.mjs --json
```

27 tests passed in this session. `check.mjs` exits 0 only if the catalog has no GPL in recommend/optional, live-capture license fields match packuments, and the minimal set is present.

## Limitations

- `/latest` moves. Captured versions are a snapshot, not a forever pin.
- License coverage is packument field + selected LICENSE files. Transitive licenses and optional native-binding licenses were not unpacked.
- ckeditor4 full LICENSE.md (GPL appendices, 76 KiB) was hashed and **not** copied; header excerpt only.
- This cell does not vendor parser source into pack `src/` (not owned). It does not implement import analysis or tarball extract.
- `es-module-lexer` TS support is type-only import/export lexing, not type checking. Dynamic/non-literal `import()` stays unknown.
- Host `tar` may be GPL as a binary; invoking it is not vendoring GPL source. Prefer in-pack ustar for license isolation.
- Did not execute parser packages (no install). Regex false-positive fixture proves why a lexer is required; it does not re-run es-module-lexer here.

## Open questions for integrator

1. Collapse c03/c05 vendor copies into a single pack `vendor/`? c03 already chose meriyah + es-module-lexer **JS/asm** (not WASM).
2. Is CJS export-diff in real cases A/B? If yes, keep `cjs-module-lexer` (already in c05 vendor).
3. Are Yarn/pnpm lockfiles in scope? If npm JSON only, skip `yaml` and `@yarnpkg/lockfile`.
4. Pin the captured versions or re-resolve at merge time and update `contentSha256`.
5. Allow `BlueOak-1.0.0` `tar@7` as optional in-process extract, or keep zlib+ustar only?
6. WASM `init()` vs JS/asm lexer build for cold CLI startup (c03 already used asm.js).

Not a paid job. Kill condition (binding vs changelog) is out of this cell.
