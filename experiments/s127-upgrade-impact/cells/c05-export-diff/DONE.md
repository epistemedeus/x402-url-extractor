# c05-export-diff DONE

Cell: `c05-export-diff`  
Schema: `s127.upgrade-impact.export-diff.v1`  
Public API: `experiments/s127-upgrade-impact/src/export-diff.mjs` → `diffExports({ oldRoot, newRoot, ... })`

## Summary

Diffs the **public export surface** of two extracted package roots. It reads `package.json` `exports` / `main` / `module` / `types`, scans JS with vendored `es-module-lexer` (ESM) and `cjs-module-lexer` (CJS), and does a bounded `.d.ts` head extract on top of the same ESM lexer (which already tags TypeScript `export type` / `export interface`). Classification:

| Kind | When |
| --- | --- |
| `added` / `removed` | Named, default, namespace, or export-map **entry** present on one side only |
| `renamed` | Heuristic **only** if both sides have a comparable (bounded) signature, shapes match, name proximity is unique, and the pair is 1:1 |
| `signatureChanged` | Same `entry`+`name` on both sides and bounded signatures differ (or `typeOnly` flips) |
| empty diff | Identical tree hash, **or** version-only bump with identical non-version tree, **or** equal surfaces |

Contract rules honored:

1. A newer version is not itself a break (`noop-version-bump`: `1.0.0` → `2.0.0`, empty `exportDiff`, `versionBumpOnly: true`).
2. Unused export change is not a caller defect (this cell does not bind usage; it only reports surface).
3. Missing/conflicting/partial source stays `unknown`/`partial`, never an action.
4. Dynamic import is recorded as unknown contribution, not followed.
5. Same tree hash short-circuits to empty diff without scanning.

No paid demand invented. Synthetic fixtures are labeled `fixture`. Parser tarballs are labeled `live-capture` (npm registry, tar extract only, no lifecycle scripts).

## How to exercise

From repo root `/tmp/s127/x402-url-extractor`:

```bash
# isolation tests (12)
node --test experiments/s127-upgrade-impact/cells/c05-export-diff/export-diff.test.mjs

# CLI JSON on a fixture pair
node experiments/s127-upgrade-impact/src/export-diff.mjs \
  --old experiments/s127-upgrade-impact/cells/c05-export-diff/fixtures/removed/old \
  --new experiments/s127-upgrade-impact/cells/c05-export-diff/fixtures/removed/new
```

Programmatic:

```js
import { diffExports } from "./experiments/s127-upgrade-impact/src/export-diff.mjs";
const packet = await diffExports({ oldRoot, newRoot, clock: "2026-09-10T10:49:11.000Z" });
// packet.exportDiff.{ added, removed, renamed, signatureChanged, coverage }
```

`coverage` is `full` | `partial` | `unknown`. Each change object has `entry`, `name`/`symbol`, `kind` (`named`|`default`|`namespace`|`entry`|`star`), `typeOnly`, optional `signature`.

Renames are **removed from** `added`/`removed` so the binder does not double-count.

## Files written

### Public module
- `experiments/s127-upgrade-impact/src/export-diff.mjs`

### Cell implementation
- `cells/c05-export-diff/entries.mjs` — `exports`/`main`/`module`/`types` entry map
- `cells/c05-export-diff/scan.mjs` — lexer scan, reexport follow, dts merge
- `cells/c05-export-diff/signature.mjs` — bounded head extract + rename proximity
- `cells/c05-export-diff/classify.mjs` — added/removed/renamed/signatureChanged
- `cells/c05-export-diff/tree-hash.mjs` — deterministic tree hash (posix-relative)
- `cells/c05-export-diff/export-diff.test.mjs` — isolation tests
- `cells/c05-export-diff/DONE.md` — this file

### Vendored MIT parsers (tar extract only)
- `cells/c05-export-diff/vendor/PROVENANCE.json` — URL / time / sha256 / coverage
- `cells/c05-export-diff/vendor/es-module-lexer/` — 3.0.2 `dist/lexer.asm.js` (JS/asm, no Wasm)
- `cells/c05-export-diff/vendor/cjs-module-lexer/` — 2.2.1 `lexer.js` (JS, no Wasm) + ESM wrapper

Captured `2026-09-10T10:49:11Z` from registry.npmjs.org. Label: **live-capture**.

### Synthetic fixtures (label: **fixture**, not live-capture)

| Id | Proves |
| --- | --- |
| `fixtures/noop-identical/` | same tree hash ⇒ empty diff |
| `fixtures/noop-version-bump/` | version 1.0.0→2.0.0 alone is not an export change |
| `fixtures/removed/` | named `gone` removed |
| `fixtures/renamed/` | `parseQuery`→`parseQueryString` heuristic |
| `fixtures/signature-changed/` | `parse(input)`→`parse(input, options)` via .d.ts+js |
| `fixtures/subpath-removed/` | `exports["./legacy"]` dropped even if file remains |
| `fixtures/dts-partial/` | ambient `declare module` ⇒ partial; does not invent `sneak()` |
| `fixtures/reexport-star/` | relative `export *` expanded |
| `fixtures/PROVENANCE.json` | fixture labels |

## Limitations

- Not a TypeScript checker. `.d.ts` coverage is lexer names + bounded declaration heads. Mapped types, overloads, declaration merging, `typesVersions`, and module augmentation stay **unknown/partial**.
- `export * from 'external-pkg'` is not expanded (external). Recorded as partial.
- Exports-map globs (`./foo/*`) are not expanded.
- CJS signatures have no source positions from `cjs-module-lexer`, so CJS `signatureChanged`/`renamed` generally will not fire (`signatureCoverage: "none"`).
- Dual `import`/`require` targets are **unioned** into one surface per subpath, not split by condition.
- `export as namespace` (UMD) is skipped.
- Dynamic `import()` is not followed.
- File caps: 64 files / 256 KiB / reexport depth 4 (overridable).
- Tree hash does not follow symlinks; hashes the link text.
- No runtime execution; no `npm install`; no network in this cell after parser capture.

## Open questions for integrator (c06 / c09 / c10)

1. Packet `exportDiff.added[]` is an array of **objects** (`entry`+`name`+`kind`+…). Flatten to symbol strings if the writer wants a slimmer packet.
2. `kind: "entry"` models package subpaths (`"."`, `"./legacy"`). Should c03/c06 treat `import "pkg/legacy"` as using symbol `./legacy`?
3. Type-only vs value of the same name is one key; `typeOnly` flip is `signatureChanged`. Split keys if TS importers need a distinct binding.
4. Prefer keeping cell-local helpers (`scan.mjs`, …) or folding them into `src/export-diff.mjs`?
5. c10 may copy these fixtures under `fixtures/synthetic/`; they currently live only under this cell (c10 owns that tree).
6. Kill condition (binding adds no value over registry+changelog) is **not** evaluated here; this cell has no caller usage graph.

## Test result

`node --test cells/c05-export-diff/export-diff.test.mjs` — **12 pass** (2026-09-10).
