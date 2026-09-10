# Real-source case C fixtures (`ms` 2.1.3 → 3.0.0-beta.2)

Upstream: `ms` (MIT, vercel/ms). Official npm registry tarballs.
Evidence class for analysis runs: **fixture**.
Tarball bytes: **live-capture** (see `PROVENANCE.json`).

This is the third structural variant, distinct from:

- Case A (`path-to-regexp`): CJS `exports.<name> =` named-function bag → string `exports`.
- Case B (`cookie`): CJS `main`+`types` → ESM-only string `exports`; used named `parse` removed.

Case C is a **default-export function** that gains a **dual CJS/ESM `exports` map** (`import` + `require` conditions). No deep subpath keys. No named-export removal.

## Versions

| Side | Version | Registry tag | Packaging |
| --- | --- | --- | --- |
| old | `2.1.3` | `latest` at capture | CJS `main` only; `module.exports = function` |
| new | `3.0.0-beta.2` | `beta` at capture | `type: module` plus `exports.import` / `exports.require` |

`3.0.0-beta.2` is an official pre-release dist-tag, not `latest`. A newer version alone is not a break. Range `^2.1.3` does not include this beta.

## Layout

| Path | Role |
| --- | --- |
| `caller/src/delay.mjs` | Primary ESM caller: **default import** of `ms`, used. |
| `caller/src/delay.cjs` | Control: CJS `require("ms")` (dual require condition). |
| `caller/src/dynamic-import.mjs` | Control: `import("ms")` ⇒ unknown for that surface. |
| `extracted/ms-*/package/` | Full official tarball members (tiny). |
| `tarballs/` | Official `.tgz` bytes (live-capture). |
| `registry/` | Slim packument + slim version documents (fixture, derived from live-capture). |
| `expected-exports.json` | Default-export oracle. |
| `case.json` | Integrator expect block. |
| `PROVENANCE.json` | url / time / sha256 / coverage / label. |

No lockfile. No paid demand. Do not `npm install` these tarballs (`prepare` / `prepublishOnly` exist on the beta). Extract with `tar` only.
