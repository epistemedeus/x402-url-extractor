# c11-real-a DONE

## Summary

Real-source case A binds **path-to-regexp** `6.3.0` → `8.4.2` (MIT, no
runtime deps) to a tiny synthetic caller.

Official npm tarballs and version documents were live-captured
`2026-09-10T10:48:00Z` from `registry.npmjs.org`, then stored as
**fixtures**. Extract used `tar` only. Both published packages declare
`prepare`; it was **not** run. No `npm install`.

Load-bearing facts are from published `package/dist/index.js`, not
changelog prose. The 8.4.2 README does not mention `tokensToFunction`.
v8 still defines an **internal** `tokensToFunction` that is not assigned
to `exports`.

| Symbol | Old public | New public | Caller | Decision |
| --- | --- | --- | --- | --- |
| `tokensToFunction` | exported | not exported (internal leftover) | used | **action** |
| `pathToRegexp` | `(path, keys, options)` → `RegExp` | `(path, options)` → `{ regexp, keys }` | used | **action** |
| `regexpToFunction` | exported | removed | imported, unused | **no_action** |
| `tokensToRegexp` | exported | removed | not imported | **no_action** |
| `stringify` / `TokenData` / `PathError` | absent | added | unused | **no_action** |
| `parse` | return array | return `TokenData` | unused | **no_action** |

Packet `summary.nextAction` = **`action`**. S122-style registry/changelog
skim of the same pair would be **`review_changelog`** (major). Binding
changes the decision (kill-condition contrast, not negative evidence).

Caller is **synthetic**. Capture is **live-capture** stored as **fixture**.
No paid demand invented or invoked.

Structure for case B: CJS `exports.<name> =` named-function bag, Express
path compiler. Distinct from default-export / ESM-only / YAML / UUID /
class-first old APIs. See `STRUCTURE.md`.

## How to exercise

From `experiments/s127-upgrade-impact/cells/c11-real-a/`:

```sh
node --test test/case-a.test.mjs
node build-packet.mjs
```

13 `node:test` tests, all passing in this cell. Offline after capture.
Do not `npm install` the tarballs.

## Limitations

- Export inventory is `exports.<Ident> =` scanning, not acorn/meriyah/es-module-lexer and not a TypeScript checker.
- `compile` / `match` stay exported; TS option/return types are unknown and not treated as action.
- No runtime execution of tarball JS. No lockfile (`lockfilePath: null`).
- No rename inference (`tokensToFunction` is not claimed to be `stringify`).
- Full packument (216334 bytes, sha256 `7d3eabbf…`) was fetched and sliced; bytes not retained.

## Open questions for integrator

1. Should imported-but-value-unused (`regexpToFunction`) be `used: false` (this cell) or `used: true` because it appears in the import clause?
2. Wire this case through c03/c05/c06 once those land; replace the conservative scanners with the pack parsers.
3. `nextAction` vocabulary: `action` vs a more specific word such as `update_caller_imports`.
4. Missing lockfile: keep resolved tarball URLs from the pin + chosen new version, or mark resolved as unknown?
5. Confirm case B does not reuse this CJS named-bag / path-compiler shape.

## Files written

### cells/c11-real-a/

- `DONE.md`
- `README.md`
- `WHY-NOT-CHANGELOG.md`
- `STRUCTURE.md`
- `package.json`
- `build-packet.mjs`
- `extract-only.sh`
- `packet.json`
- `lib/paths.mjs`
- `lib/hash.mjs`
- `lib/resolve-entry.mjs`
- `lib/cjs-named-exports.mjs`
- `lib/static-imports.mjs`
- `lib/export-diff.mjs`
- `lib/bind.mjs`
- `lib/packet.mjs`
- `test/case-a.test.mjs`

### fixtures/real-a/

- `PROVENANCE.json`
- `README.md`
- `registry/packument.slim.json`
- `registry/path-to-regexp-6.3.0.json`
- `registry/path-to-regexp-8.4.2.json`
- `tarballs/path-to-regexp-6.3.0.tgz`
- `tarballs/path-to-regexp-8.4.2.tgz`
- `extracted/6.3.0/package/**` (official tar extract)
- `extracted/8.4.2/package/**` (official tar extract)
- `caller/package.json`
- `caller/src/reverse-route.mjs`
- `inventories/expected-exports.json`
- `inventories/export-diff.json`
- `inventories/caller-usage.json`

### evidence/real-a/

- `README.md`
- `CAPTURED_AT_UTC.txt`
- `sha256sums.txt`
- `official-quotes.md`
- `s122-contrast.md`
- `capture-receipt.json`

No writes outside owned paths. S124/S125 trees untouched.
