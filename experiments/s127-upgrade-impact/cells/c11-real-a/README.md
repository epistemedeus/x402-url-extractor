# Cell c11-real-a — real-source case A

Package: **path-to-regexp** `6.3.0` → `8.4.2` (MIT).

Tiny synthetic caller imports:

- `tokensToFunction` (used, **removed**)
- `pathToRegexp` (used, **signature changed**)
- `regexpToFunction` (imported, unused, **removed**)

Decision: `action` on the used symbols; `no_action` on unused export
changes. A newer version alone is not a break.

## Exercise (offline)

From this directory:

```sh
node --test test/case-a.test.mjs
node build-packet.mjs
```

Do not `npm install` the captured tarballs. Both declare `prepare`.

See `WHY-NOT-CHANGELOG.md` and `STRUCTURE.md`.
