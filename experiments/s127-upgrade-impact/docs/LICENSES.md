# S127 upgrade-impact license policy

Pack code is MIT, same family as the merchant tree (`LICENSE` at repo root). This file is the **dependency license gate** for parsers the integrator may reuse. Cell implementation: `cells/c13-dep-license/`.

A new parser version is not itself a break. An unused export change in a parser we do not call is not a caller defect. Missing or conflicting license metadata stays `unknown` until a file is read — it is not permission to add the package.

## Rules

1. **Do not add GPL, AGPL, or LGPL** (including `-only` / `-or-later`) to the pack as source, vendored trees, or runtime dependencies.
2. Dual `MIT OR GPL-*` is allowed **only** if the chosen expression is the permissive side and GPL-only files are not shipped. Prefer not using those packages at all.
3. `MIT AND AGPL-*` (or any AND with a denied identifier) is **denied**.
4. Packument `SEE LICENSE IN …` is **unknown** until the license file is read. After reading, apply the same gate (tinymce 8.9.1 → GPL-2.0-or-later or commercial → do not add).
5. SPDX `MIT` on a wrapper is not enough if `postinstall` runs or a copyleft native binary is fetched (gifsicle 7.0.1).
6. Prefer Node built-ins and small MIT/Apache/ISC/BSD parsers over regex that claims full TypeScript analysis. TS, dynamic `import()`, `export *`, and missing source stay **unknown**.
7. If an optional npm dependency is installed: `--ignore-scripts`. Extract acquired registry tarballs with `tar` only. Never run package lifecycle scripts from untrusted tarballs.
8. Invoking a host `tar` binary is a tool call, not vendoring GNU tar. Do not copy GPL tar sources into the pack. Prefer `node:zlib` plus a small ustar reader for npm `.tgz`.

## Allow / deny (SPDX)

Allowed (permissive): `MIT`, `MIT-0`, `Apache-2.0`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `0BSD`, `Unlicense`, `CC0-1.0`, `BlueOak-1.0.0`.

Denied: `GPL-*`, `AGPL-*`, `LGPL-*`, `SSPL-*`, `BUSL-*`, `Commons-Clause`, `CC-BY-NC-*`, `UNLICENSED`.

Machine check: `node cells/c13-dep-license/check.mjs`.

## Minimal set for the integrator

Zero extra npm dependencies is the S122 default. The packet contract still needs **grammar-aware ESM import/export lexing**. Regex is not that.

| Need | Reuse | SPDX | How |
| --- | --- | --- | --- |
| Hash, JSON, paths, gzip | Node `crypto` / `fs` / `path` / `url` / `zlib` / `JSON.parse` | Node MIT | Built-in |
| Exact `oldVersion`→`newVersion` | S122 `recipes/lib/semver.mjs` | MIT | Copy the ~25-line classifier |
| ESM imports/exports | `es-module-lexer` **3.0.2** | MIT | Vendor dist or optionalDep, `--ignore-scripts` |
| npm `.tgz` extract | `node:zlib` + ustar, or host `tar` CLI | MIT / host tool | Never `npm install` the acquired tarball |

Add **only if the corresponding caller surface exists**:

| Surface | Package (captured latest 2026-09-10) | SPDX | Reuse |
| --- | --- | --- | --- |
| CJS named exports | `cjs-module-lexer` 2.2.1 | MIT | Vendor or optional |
| JS AST beyond the lexer | **one of** `acorn` 8.18.0 (MIT, smaller) **or** `meriyah` 7.3.3 (ISC) | MIT / ISC | Optional; not both. c03 already vendored meriyah 7.3.3. |
| npm ranges (`^`, `~`) | `semver` 7.8.5 | ISC | Optional; skip for exact pins |
| `pnpm-lock.yaml` | `yaml` 2.9.0 | ISC | Optional |
| Yarn classic `yarn.lock` | `@yarnpkg/lockfile` 1.1.0 | BSD-2-Clause | Optional |
| `tsconfig.json` JSONC | `jsonc-parser` 3.3.1 | MIT | Optional |

## Do not add (even when SPDX is permissive)

| Package | Captured | SPDX field | Why not |
| --- | --- | --- | --- |
| `typescript` | 7.0.2 | Apache-2.0 | Native optional farm, ~2.5MiB. Label TS unknown instead. |
| `oxc-parser` | 0.149.0 | MIT | 19 optional native bindings. |
| `@typescript-eslint/parser` | 8.70.0 | MIT | Peers `eslint` + `typescript`. |
| `@babel/parser` | 8.0.4 | MIT | ~1.8MiB, engines `^22.18 \|\| >=24.11`. |
| `sucrase` | 3.35.1 | MIT | 7 deps; strip ≠ type analysis. |
| `tar` | 7.5.22 | BlueOak-1.0.0 | Allowed license, ~2.3MiB + 5 deps. Use ustar. |
| `@pnpm/lockfile-file` | 9.1.3 | MIT | 19 dependencies. |
| `js-yaml` | 5.4.1 | MIT | Prefer `yaml` (0 deps). |
| `ssri` | 14.0.0 | ISC | `node:crypto` is enough. |
| `parse5` | 8.0.1 | MIT | HTML is out of contract. |
| `gifsicle` | 7.0.1 | MIT | `postinstall` + GPL binary. |
| `tinymce` | 8.9.1 | SEE LICENSE IN | GPL-2.0-or-later or commercial. |
| `ckeditor4` | 4.25.2 | SEE LICENSE IN | LTS commercial; older GPL/LGPL/MPL. |
| `jszip` | 3.10.2 | MIT OR GPL-3.0-or-later | Dual OK only via MIT; npm packs are `.tgz` not zip. |

Synthetic gate fixtures (not packages): `GPL-3.0-only` parser; `MIT AND AGPL-3.0-only`; MIT regex that claims full TS analysis. All `do_not_add`.

## Why a lexer instead of regex

Naive `import { … } from '…'` regex on `cells/c13-dep-license/fixtures/regex-false-positives.source.txt` matches imports inside comments and string literals, type-only TS imports, and still misses non-literal `import(variableName)`.

`es-module-lexer` walks the JS grammar for specifier locations (including dynamic import sites). That is the static `usage` input for the packet. Dynamic or non-literal import ⇒ `dynamicImport: true` ⇒ **unknown** contribution (contract rule 4). TypeScript beyond type-only import lexing ⇒ **unknown**.

## Provenance

Live-capture batch **2026-09-10T10:45:04Z** (UTC), `GET https://registry.npmjs.org/<name>/latest` and Unpkg LICENSE files. No tarball install, no lifecycle scripts, $0.

| Artifact | Label | Where |
| --- | --- | --- |
| npm latest packuments | live-capture | `cells/c13-dep-license/fixtures/live-capture/packuments/` |
| slim index + sha256 | live-capture | `…/packuments-slim.json` |
| LICENSE bodies (subset) | live-capture | `…/licenses/` |
| Node built-ins / S122 semver | fixture | catalog entries |
| GPL/regex policy rows | synthetic | catalog entries |

Coverage: license field, dist integrity, unpacked size, direct dependency names, install-script keys. Not covered: transitive licenses, native binding licenses, full tarball contents.

Recapture if the integrator pins different versions. `/latest` moves.

## Attribution when vendoring

Keep each vendored tree's `LICENSE` (or `LICENSE.md`) next to the code. MIT/ISC/BSD require the copyright notice in copies. Apache-2.0 is allowed but this pack should not vendor `typescript`.

Pack-level policy implementation: `cells/c13-dep-license/policy.mjs` (`s127.c13.dep-license.policy.v1`).
