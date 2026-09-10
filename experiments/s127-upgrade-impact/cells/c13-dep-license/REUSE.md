# Parser reuse for S127 upgrade-impact

Integrator guide. License table and deny list: [`docs/LICENSES.md`](../../docs/LICENSES.md). This cell does **not** vendor parser source into `src/` (not owned). It records what to reuse, why regex is not enough, and what must stay out of the pack.

## Minimal set

Ship these four. Nothing else until a real caller surface needs it.

1. **Node built-ins** — `node:crypto`, `node:fs`, `node:path`, `node:url`, `node:module`, `node:zlib`, `JSON.parse`, `node:test`. No extra license file.
2. **S122 core semver** — copy `experiments/s122-application-jobs/recipes/lib/semver.mjs` (cell fixture: `fixtures/local-semver.mjs`). Exact `x.y.z` / `vX.Y.Z`. Ranges and junk → `unknown`. Packet `oldVersion`/`newVersion` are resolved versions, so this is enough. A newer version alone is not a break.
3. **`es-module-lexer` 3.0.2 (MIT, 0 deps)** — ESM import/export metadata for `usage` and `exportDiff`. Vendor the published dist (JS and/or WASM) **or** document an optionalDependency. Extract the registry tarball with `tar`; `--ignore-scripts` if `npm` is used. Keep `LICENSE`.
4. **Extract without install** — npm packs are gzip+ustar. Use `node:zlib` plus a small ustar reader in `src/acquire.mjs` (c04), or spawn host `tar`. Do **not** add `tar@7` (BlueOak, ~2.3MiB, 5 deps) by default. Never `npm install` an acquired dependency tarball.

### If CJS entrypoints appear in case A/B

Promote **`cjs-module-lexer` 2.2.1 (MIT, 0 deps)** from optional to recommend. Same vendor rules. Node uses this lexer for CJS named exports; regex on `exports.foo =` is the wrong tool.

### If the lexer cannot answer a JS question

Add **one** ESTree parser, not two:

- `acorn` 8.18.0 MIT, 0 deps, ~565 KiB unpacked (prefer for size)
- `meriyah` 7.3.3 ISC, 0 deps, ~1.3 MiB unpacked, **no TypeScript**

`acorn-walk` 8.3.5 only with acorn. Parse failure on TS/TSX → `unknown`, not `action`.

Parallel cells (c03, c05) already vendored **es-module-lexer 3.0.2** (JS/asm `./js` build, not WASM), **cjs-module-lexer 2.2.1**, and **meriyah 7.3.3** at matching pins. Integrator should collapse to **one** vendor tree and not also add acorn if meriyah is kept.

### If lockfiles are not npm JSON

| Lockfile | Parser | SPDX | Note |
| --- | --- | --- | --- |
| `package-lock.json` / shrinkwrap | `JSON.parse` | builtin | default |
| `pnpm-lock.yaml` | `yaml` 2.9.0 | ISC | 0 deps; do not add `@pnpm/lockfile-file` (19 deps) |
| Yarn classic `yarn.lock` | `@yarnpkg/lockfile` 1.1.0 | BSD-2-Clause | 0 deps |
| Yarn Berry | `@yarnpkg/parsers` | BSD-2-Clause | js-yaml dep; add only if seen |
| `bun.lock` | `JSON.parse` | builtin | |
| `bun.lockb` | — | — | unknown |

Alias / workspace / lockfile disagreement ⇒ `unknown` (contract rule 5).

### If range satisfaction is required

`semver` 7.8.5 ISC, 0 deps. Skip when comparing exact resolved versions.

### If `tsconfig.json` paths are bound

`jsonc-parser` 3.3.1 MIT, 0 deps. Prefer over `comment-json` (esprima). Unresolved paths ⇒ `unknown`.

## Why these beat regex

`fixtures/regex-false-positives.source.txt` contains:

- an `import` in a comment
- an `import` in a string literal
- one real static `import { used } from "real-dep"`
- a TypeScript `import type`
- `import(variableName)` (dynamic, non-literal)

`fixtures/naive-import-regex.mjs` matches the comment, the string, the real import, and the type-only import. A packet built from that regex would bind the wrong symbols.

`es-module-lexer` reports specifier locations using the JS grammar (comments/strings/templates, import attributes, `import.meta`, dynamic import sites). The full build also lexes type-only TS import/export **forms**. It is still not a type checker.

Limits to keep in `limitations` / `unknownReasons`:

- non-literal `import()` → `dynamicImport: true` → unknown
- `export *` not expanded across files → unknown until followed or reported
- TS enums, namespaces, `export =`, `import = require()`, ambient `declare module`, decorators → unknown
- missing, partial, or conflicting source → unknown (contract rule 3)
- unused export change → not a caller defect (contract rule 2)

Do not recommend a MIT regex module that claims “full TypeScript analysis”. Catalog id `synthetic-regex-full-ts` is `do_not_add` for that reason.

## How to vendor (no lifecycle scripts)

```bash
# Example: es-module-lexer @ captured pin. Run from the pack root after integrator owns src/vendor.
mkdir -p vendor/es-module-lexer
curl -fsSL "https://registry.npmjs.org/es-module-lexer/-/es-module-lexer-3.0.2.tgz" \
  | tar -xz --strip-components=1 -C vendor/es-module-lexer
# Confirm LICENSE is present. Do not npm install this tree.
# Optional instead: npm install --ignore-scripts es-module-lexer@3.0.2
```

Pin `dist.integrity` from `fixtures/live-capture/packuments-slim.json`. Captured `es-module-lexer@3.0.2`:

`sha512-BuIB67FngDSyQ/dpQNOZybwdEBDUGJQvOqwWr4ha/ufYiqzuEwPkKO2zLhRAgay28tStRIHUeWmszZAJo3GCOg==`

WASM build needs `await init()`. JS build (`es-module-lexer/js`) avoids WASM if the integrator wants fewer moving parts. Either is MIT.

## Do not add GPL to the pack

Live-capture counterexamples (not parsers we need; they prove the gate):

- **tinymce@8.9.1** — packument `SEE LICENSE IN license.md`; file is GPL-2.0-or-later **or** Tiny commercial terms.
- **ckeditor4@4.25.2** — LTS commercial; older lines GPL/LGPL/MPL. Header excerpt only; full GPL text not copied into the pack.
- **gifsicle@7.0.1** — SPDX MIT + `postinstall` + GPL native binary.
- **jszip@3.10.2** — `(MIT OR GPL-3.0-or-later)`. Dual would be choosable as MIT; still unused (npm is `.tgz`).

Synthetic: `GPL-3.0-only`; `MIT AND AGPL-3.0-only` (AND does not save you).

GNU tar as a **host CLI** is not vendored GPL. Do not copy GNU tar sources into `vendor/`.

## Mapping to cells

| Cell | Parser |
| --- | --- |
| c02 lockfile/alias | JSON.parse; optional `yaml`, `@yarnpkg/lockfile`, `jsonc-parser`, `semver` |
| c03 static imports | **es-module-lexer**; optional one AST |
| c04 source acquire | zlib+ustar or host tar; hashes via `node:crypto` |
| c05 export-diff | es-module-lexer; optional cjs-module-lexer |
| c06 bind | no extra parser; consumes c03+c05 |
| c07 unknown | records lexer/TS/dynamic limits |

## What this cell did not do

- Did not `npm install` anything into the pack.
- Did not vendor parser source (owned paths are this cell + `docs/LICENSES.md`).
- Did not invent paid demand or a marketplace job.
- Did not claim TypeScript is solved.

Captured `/latest` versions will move. Re-run the registry GET and compare `contentSha256` in `fixtures/live-capture/packuments-slim.json` before pinning.
