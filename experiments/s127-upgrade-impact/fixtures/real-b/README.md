# Real-source case B fixtures

Upstream: `cookie@1.1.1` → `cookie@2.0.1` (MIT, jshttp).
Evidence class for analysis runs: **fixture**.
Tarballs and raw version documents: **live-capture** under `../../evidence/real-b/`.
Provenance: `PROVENANCE.json` (url/time/sha256/coverage/label).

## Packaging contrast

- Old: CJS `main` + `types`, no `exports` map.
- New: ESM-only string `exports`, no `main`, no `types` field (adjacent `dist/index.d.ts` still in the tarball).
- Distinct from case A `path-to-regexp@8.4.2`, which keeps `main` + `typings` and is not `"type": "module"`.

## Layout

| Path | Role |
| --- | --- |
| `caller/src/read-session-cookie.mjs` | Primary ESM caller: named import of **`parse`** (removed in 2.x). Does not import `serialize`. |
| `caller/src/parse-cookie-only.mjs` | Control: named import of stable **`parseCookie`**. Same bump must not be an export-binding break. |
| `caller/src/dynamic-import.mjs` | Control: `import("cookie")` ⇒ unknown for that surface. |
| `extracted/cookie-*/` | Tarball entrypoints only (`package.json`, `LICENSE`, `dist/index.js`, `dist/index.d.ts`). Source maps omitted. |
| `npm/` | Slim version docs + slim packument (fixture). |
| `github/releases-slim.json` | Changelog corroboration; not the export source of truth. |
| `expected-exports.json` | Named-export oracle derived from the extracted JS/d.ts. |

No lockfile. No paid demand. Caller is synthetic (not a production app) but uses a real changed export.
