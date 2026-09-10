# Real-source case B evidence notes

Package: `cookie` (jshttp, MIT).
Pin pair: `1.1.1` (published `2025-11-26T17:50:20.759Z`) → `2.0.1` (published `2026-06-30T22:15:13.965Z`).
Capture clock: `2026-09-10T10:50:00Z` (GET window `10:46Z`–`10:50Z`).
Paid demand: none. Price invoked: none. Owner-QA case only.

## Why this package (vs a typical single-`main` case A)

| Version | Module form | Entry |
| --- | --- | --- |
| `1.1.1` | CJS (no `"type"`) | `main` + `types`, **no** `exports` |
| `2.0.1` | ESM (`"type": "module"`) | string `exports: "./dist/index.js"`, **no** `main`, **no** `types` field |

This is an **ESM-only** package on the new side (`"type": "module"`, string `exports`, no `main`, no `types` field), with bundled `dist/index.d.ts` still in the tarball.

Case A (observed): `path-to-regexp@6.3.0` → `8.4.2`. That 8.x manifest still has `main` + `typings` and is **not** `"type": "module"`. Different package and different module form.

S122 used `vercel`, `@anthropic-ai/claude-code`, and Node.js EOL — not `cookie`.

## Official sources (no package scripts)

- npm tarballs: `https://registry.npmjs.org/cookie/-/cookie-1.1.1.tgz`, `.../cookie-2.0.1.tgz`
- npm version docs: `https://registry.npmjs.org/cookie/1.1.1`, `.../cookie/2.0.1`
- npm packument (slimmed): `https://registry.npmjs.org/cookie`
- GitHub releases (changelog corroboration only): `https://api.github.com/repos/jshttp/cookie/releases?per_page=10`

Extract: `tar` only. Never `npm install`. Tarball JS is never executed.

## Binding vs registry + changelog

Registry-only: a newer major exists (`1.1.1` → `2.0.1`).

GitHub `v2.0.0` body says the old `parse` and `stringify` methods were renamed to `parseCookie` and `stringifySetCookie`, and that the package is ESM-only.

Compiled JS for `1.1.1` actually exports **`parse` and `serialize`** as aliases (plus `parseCookie`, `stringifyCookie`, `stringifySetCookie`, `parseSetCookie`). There is **no** runtime export named `stringify`. Changelog skim can miss `serialize`.

| Surface | Used by primary caller? | Observed change | Decision |
| --- | --- | --- | --- |
| `parse` | yes | removed (alias) | **action** |
| `serialize` | no | removed (alias) | **no_action** (unused ≠ caller defect) |
| `stringifySetCookie` | no | `.d.ts` overload count 2 → 1 | **no_action** |
| `parseCookie` | no (primary) | name present both sides | not a caller defect |

A second caller that already imports `parseCookie` gets **no_action** on named exports for the same bump (newer version alone ≠ break). Engines `>=18` → `>=22` stay **unknown**, not an export binding.

## Labels

- `live-capture`: bytes retrieved from the official URL this session.
- `fixture`: frozen analysis input derived from that capture (extracted entrypoints, slims, synthetic caller).
