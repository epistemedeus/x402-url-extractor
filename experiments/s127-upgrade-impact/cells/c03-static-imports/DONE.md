# c03-static-imports DONE

Cell: static import / require / export-from usage of a target package.

Schema: `s127.upgrade-impact.usage.v1`

## Summary

Given `sourceRoots[]` and a target `packageName`, the analyzer walks caller source (not `node_modules` / `.git`) and emits usage records:

```js
{ file, specifier, names[], dynamic, dynamicImport, kind, typeOnly, typeNames[], coverage, ... }
```

- **ESM** (`import`, `export … from`, `import()`): `es-module-lexer` 3.0.2 (MIT, vendored asm.js / no WASM). Named clauses parsed with meriyah on the statement (TS `import type` / `{ type X }` rewritten first).
- **CJS `require()`** and **JSX/TSX fallback** when the lexer fails: meriyah 7.3.3 (ISC, vendored).
- **`.ts/.tsx`**: not type-aware. Lexer on original source; meriyah on original or Node `stripTypeScriptTypes` when needed. Coverage is `partial`.
- **`import()`** (string, static template, or glob) ⇒ `dynamic: true`, `dynamicImport: true`, `coverage: "unknown"`. Names are not claimed.
- **`import(expr)` / `require(expr)`** with no constant specifier ⇒ `unresolvedDynamics[]` (cannot attribute to the package).
- A new version is not itself a break; this cell only reports the caller import surface.

No paid demand. Caller tree is **synthetic**. Parsers are **live-capture** of public npm tarballs (see `vendor/PROVENANCE.md`).

## Files written

Owned paths only:

| Path | Role |
| --- | --- |
| `src/imports.mjs` | Integrator facade + CLI |
| `cells/c03-static-imports/analyze.mjs` | Implementation |
| `cells/c03-static-imports/cli.mjs` | Cell CLI |
| `cells/c03-static-imports/test/imports.test.mjs` | Isolation contract tests (node:test) |
| `cells/c03-static-imports/fixtures/synthetic-caller/**` | Synthetic caller (`label: synthetic`) |
| `cells/c03-static-imports/vendor/es-module-lexer/**` | MIT lexer 3.0.2 |
| `cells/c03-static-imports/vendor/meriyah/**` | ISC parser 7.3.3 |
| `cells/c03-static-imports/vendor/PROVENANCE.md` | URL / time / sha256 / coverage |
| `cells/c03-static-imports/DONE.md` | This file |

## How to exercise

From pack root `experiments/s127-upgrade-impact`:

```bash
node --test cells/c03-static-imports/test/imports.test.mjs

node src/imports.mjs \
  --package example-dep \
  --root cells/c03-static-imports/fixtures/synthetic-caller \
  --label synthetic
```

API:

```js
import { analyzeStaticImports, analyzeFileSource, matchesPackageSpecifier } from "./src/imports.mjs";

const result = analyzeStaticImports({
  packageName: "example-dep",
  sourceRoots: ["/path/to/caller"],
  provenanceLabel: "synthetic", // or fixture | live-capture
});
// result.ok, result.usage[], result.unresolvedDynamics[], result.filesUnknown[], result.limitations[]
```

Package match: exact specifier, subpath `name/...`, and lexer globs `name/*` / `name-*`. `name-extra` does not match `name`. Scoped packages require the full `@scope/name`.

`names[]` tokens:

| Surface | names |
| --- | --- |
| `import x from 'pkg'` | `["default"]` |
| `import * as ns from 'pkg'` | `["*"]` |
| `import { a, b as c } from 'pkg'` | `["a","b"]` (exported names, not locals) |
| `import 'pkg'` | `[]` (side-effect; still a usage row) |
| `export { a } from 'pkg'` / `export * from 'pkg'` | `["a"]` / `["*"]` |
| `const x = require('pkg')` | `["*"]` |
| `const { a } = require('pkg')` | `["a"]` |
| `import()` | `[]` plus `dynamicImport: true` |

On the synthetic fixture (`example-dep`): 19 files scanned, 22 usage rows, 1 unknown file (`src/syntax-error.js`), 1 unresolved dynamic (`import("example-" + "dep")`). `node_modules/example-dep` is skipped. `example-dep-extra` is not a false positive.

## Limitations

- No TypeScript checker, path mapping, `typesVersions`, or project references.
- `typeOnly` is whole-statement (`import type …`). Inline `{ type Beta, gamma }` keeps `typeOnly: false` and lists `typeNames: ["Beta"]`.
- Dynamic `import()` of a known specifier still has **unknown contribution** (packet rule 4).
- `import(expr)` cannot be attributed; listed under `unresolvedDynamics` only.
- Aliased `require` (`const r = require; r('pkg')`) and `require.resolve` are not treated as export usage.
- Member use after `const x = require('pkg')` / namespace import is not followed (c06 binding, not this cell).
- Enums, namespaces, and angle-bracket assertions can block Node type-strip; `require()` in those files may be missed.
- JSX/TSX often fails the ESM lexer; meriyah `jsx` is the fallback. TSX that also uses type-only syntax may stay unknown.
- `stripTypeScriptTypes` is experimental (Node 22+). Node 20: TS `require()` coverage weaker.
- Files > 2 MiB skipped. Symlinks not followed. Binary (NUL) skipped.
- Did not invent live caller demand; did not fetch application source from the network.

## Open questions for integrator (c06 / c09)

1. Should any `unresolvedDynamics` in scanned files force packet `summary.nextAction = unknown` even when static names are complete?
2. Is `*` the agreed token for namespace / `export *` / whole-module `require`, meaning “any export change may matter”?
3. Should type-only names (`typeOnly` / `typeNames`) bind against type-export diffs, value diffs, both, or stay unknown?
4. File paths are POSIX-relative to each `sourceRoot` (plus `sourceRoot` on the row). Prefer cwd-relative or `caller.manifestPath`-relative instead?
5. Include `.vue` / `.svelte` / `.mdx`? Currently `.js/.mjs/.cjs/.jsx/.ts/.tsx/.mts/.cts` only (`.d.ts` included as `.ts`).
6. Side-effect `import 'pkg'` (`names: []`): treat as usage of the module graph, or ignore for export-diff binding?
7. `import foo = require('pkg')` is `kind: "import-equals"`, `names: ["*"]`, `coverage: "partial"`. Collapse to `require`?

## Provenance labels

| Artifact | label | notes |
| --- | --- | --- |
| `fixtures/synthetic-caller/**` | synthetic | Hand-authored. Specifiers `example-dep` / `@scope/example-dep`. Not live-capture. No paid demand. |
| `vendor/es-module-lexer` | live-capture | npm tarball 3.0.2, 2026-09-10T10:51:51Z, sha256 `d1bbfa8b42e0a7261abb701b84a0d9a7f7121b68408898cbb2200f5024dcfd4f` |
| `vendor/meriyah` | live-capture | npm tarball 7.3.3, same timestamp, sha256 `77035f779cd56bc04fc1244c30263974af386c57068946dd1d180d5b64ed43db` |

Tarballs extracted with `tar` only. No `npm install`. No lifecycle scripts.
