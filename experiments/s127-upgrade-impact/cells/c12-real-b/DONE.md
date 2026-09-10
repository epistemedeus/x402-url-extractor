# c12-real-b DONE

## Summary

Real-source case B is **`cookie@1.1.1` → `cookie@2.0.1`** (MIT, jshttp). Official npm tarballs and version documents were live-captured; analysis runs as **fixture**.

Packaging is **not** case A’s `path-to-regexp` and **not** a leftover `main`+`typings` dual entry:

| | `cookie@1.1.1` | `cookie@2.0.1` | case A `path-to-regexp@8.4.2` (observed) |
| --- | --- | --- | --- |
| module | CJS (no `"type"`) | `"type": "module"` | no `"type": "module"` |
| entry | `main` + `types` | string `exports` only | `exports` **and** `main` + `typings` |

Primary caller (synthetic ESM, not a production app) **uses `parse`** and does **not** use `serialize`.

| Surface | Used? | Change | Decision |
| --- | --- | --- | --- |
| `parse` | yes | removed (1.1.1 alias of `parseCookie`) | **action** |
| `serialize` | no | removed (alias of `stringifySetCookie`) | **no_action** |
| `stringifySetCookie` | no | `.d.ts` overload count 2 → 1 | **no_action** |
| `parseCookie` | no (primary) | present both sides | — |

`summary.nextAction` is **action** because the used alias is gone. A control caller that already imports `parseCookie` gets **no_action** on named exports for the same bump (newer version alone ≠ break). Dynamic `import("cookie")` is **unknown**.

Binding vs registry/changelog: a major exists either way; GitHub `v2.0.0` says `stringify` was renamed, but 1.1.1 compiled JS exports **`serialize`**, not `stringify`. The packet uses compiled named exports as source of truth. Unused `serialize` is not a caller defect.

No paid demand. No price invoked. Tarball JS was never executed. No `npm install`.

## Files written

### `cells/c12-real-b/`

- `DONE.md` (this file)
- `README.md`
- `package.json`
- `packet.v1.json` (generated)
- `lib/hash.mjs`
- `lib/paths.mjs`
- `lib/packaging.mjs`
- `lib/scan-exports.mjs`
- `lib/scan-imports.mjs`
- `lib/export-diff.mjs`
- `lib/bind.mjs`
- `lib/packet.mjs`
- `scripts/build-packet.mjs`
- `test/helpers.mjs`
- `test/case-b-contract.test.mjs`

### `fixtures/real-b/` (analysis inputs; evidence class **fixture**)

- `README.md`
- `PROVENANCE.json`
- `expected-exports.json`
- `caller/package.json`
- `caller/src/read-session-cookie.mjs` (primary: `parse`)
- `caller/src/parse-cookie-only.mjs` (control: stable name)
- `caller/src/dynamic-import.mjs` (control: unknown)
- `extracted/cookie-1.1.1/{package.json,LICENSE,dist/index.js,dist/index.d.ts}`
- `extracted/cookie-2.0.1/{package.json,LICENSE,dist/index.js,dist/index.d.ts}`
- `npm/cookie-1.1.1-version.slim.json`
- `npm/cookie-2.0.1-version.slim.json`
- `npm/cookie-packument.slim.json`
- `github/releases-slim.json`

### `evidence/real-b/` (official captures)

- `CAPTURED_AT_UTC.txt` (`2026-09-10T10:50:00Z`; GET window `10:46Z`–`10:50Z`)
- `NOTES.md`
- `sha256sums.txt`
- `cookie-1.1.1.tgz` (live-capture; sha256 `0e9342b066986722098d9b108b238033862eae90b3d53ff90581538264d91b60`)
- `cookie-2.0.1.tgz` (live-capture; sha256 `8516126668fc55128916561047c055db77d0401dee1db108adce7267b4b06ff0`)
- `npm/cookie-1.1.1-version.json`
- `npm/cookie-2.0.1-version.json`
- `npm/cookie-packument.slim.json`
- `github/releases-slim.json`

## How to exercise

```bash
cd experiments/s127-upgrade-impact/cells/c12-real-b
node --test test/*.test.mjs
node scripts/build-packet.mjs
```

No install step. Isolated `node:test` covers provenance hashes, `tar -xOf` vs extracted JS, packaging contrast, used/unused bind, parseCookie-only no_action, dynamic-import unknown, same-version no_action, missing source unknown.

## Limitations

- Compiled-JS named-export walk + `.d.ts` `export declare function` overload counts. Not a TS checker, not es-module-lexer, not a CJS graph.
- No runtime exec of cookie code.
- No lockfile on the synthetic caller.
- `cookie@2.0.1` omits `package.json` `types`; adjacent `.d.ts` is not a resolution proof.
- `engines.node` `>=18` → `>=22` is recorded as unknown, not an export binding.
- ESM caller only; CJS `require("cookie")` against 2.x is out of scope.
- Source maps omitted from fixtures; full tarball is in evidence.
- Changelog body is corroboration only.

## Open questions for integrator

1. Lift `packaging` / `commercial` extra fields into the schema, or strip them?
2. Treat engines/ESM-only as first-class bindings, or keep them in `unknownReasons` as here?
3. Alias removal: `changeKind: removed` (compiled JS) vs `renamed` (changelog). Packet lists both: JS `removed` drives the decision; `exportDiff.renamed` is changelog-only coverage.
4. `.d.ts` overload drop on unused `stringifySetCookie`: keep as `signatureChanged` with partial coverage, or fold into unknown-TS?
5. Wire this packet through c04 acquire + c03/c05/c06 instead of the cell-local scanners.
6. Case A is `path-to-regexp`; keep B as the ESM-only alias-removal case.
7. Kill condition: this case **does** change the decision relative to “new major exists / skim changelog” (used `parse` → action; unused `serialize` → no_action; parseCookie-only caller → no_action; changelog `stringify` ≠ compiled `serialize`). Do not package as a paid job; no organic demand.
