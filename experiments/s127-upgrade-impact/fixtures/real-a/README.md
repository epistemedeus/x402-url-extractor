# Real-source case A (`path-to-regexp` 6.3.0 → 8.4.2)

MIT, zero runtime dependencies, official npm tarballs.

Replay copies live in this directory. Capture was a live HTTPS GET of the
npm registry; stored bytes are **fixtures** (see `PROVENANCE.json`).

## Why this pair

- `6.3.0` is the registry `old` dist-tag (published `2024-09-12T01:09:36.065Z`).
- `8.4.2` is `latest` at capture (published `2026-04-01T21:17:05.201Z`).
- Public CJS named exports actually change. This is not a version bump with
  an identical export bag.

Verified against official `package/dist/index.js` (and corroborated by
`dist/index.d.ts`), not against changelog prose. The 8.4.2 README does not
even mention `tokensToFunction`.

## Structure (keep distinct from case B)

- Domain: Express-style path compiler.
- Module format: CJS `__esModule` named-function bag (`exports.foo = foo`).
- Change: **removed named functions** plus **arity/return-shape** of surviving
  `pathToRegexp`.
- Not a default-export function, not ESM-only, not YAML, not UUID, not a
  class-first old API.

## Do not

- `npm install` these tarballs (both declare a `prepare` script).
- Execute JS from the tarball as a trust boundary.
- Treat a newer version alone as a caller break.
- Treat unused export changes (`regexpToFunction`, `stringify`, …) as defects.

## Replay extract

```sh
tar -tzf tarballs/path-to-regexp-6.3.0.tgz
tar -xzf tarballs/path-to-regexp-6.3.0.tgz -C /tmp/out-old
```

Use `tar` only.
