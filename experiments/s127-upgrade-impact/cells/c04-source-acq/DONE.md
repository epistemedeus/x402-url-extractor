# c04-source-acq DONE

## Summary

Offline-first npm package source acquisition with provenance. `acquire({ name, version, mode })` returns `{ schema, ok, rootDir, provenance }` and never runs lifecycle scripts or `npm install`.

- **fixture** (default): local catalog + unpacked `package/` trees and/or `.tgz` files under this cell. Label `fixture`. Not a live-capture.
- **live** (optional, free registry only): GET version document + tarball from the chosen registry origin (default `https://registry.npmjs.org`), refuse redirects and off-origin hosts, then `tar --no-same-owner --no-same-permissions`. Label `live-capture`. This cell did **not** hit npmjs; live is proven with a localhost mock.

Coverage is exactly `full tarball | partial page | missing`. Packet fields `url`, `path`, `retrievedAt`, `sha256`/`contentSha256`, `label` are always present. A newer version is not classified here.

Stub packs are synthetic (`s127-demo-lib` 1.0.0 → 2.0.0 export-surface change, `@s127/tiny`, partial page, missing). They are not npm publications and are not paid demand.

Isolation tests: **22 passed** (`node --test cells/c04-source-acq/acquire.test.mjs`).

## Files written

| Path | Role |
| --- | --- |
| `src/acquire.mjs` | `acquire`, `acquirePair`, tar extract, allowlist, provenance |
| `cells/c04-source-acq/index.mjs` | re-exports + `CELL_FIXTURE_ROOT` |
| `cells/c04-source-acq/acquire.test.mjs` | node:test contract proof |
| `cells/c04-source-acq/pack-fixtures.mjs` | rebuild tarballs/hashes (tar only) |
| `cells/c04-source-acq/fixtures/README.md` | layout |
| `cells/c04-source-acq/fixtures/catalog.json` | name@version index |
| `cells/c04-source-acq/fixtures/PROVENANCE.json` | fixture vs live-capture labels |
| `cells/c04-source-acq/fixtures/packs/s127-demo-lib/1.0.0/package/*` | unpacked old tree |
| `cells/c04-source-acq/fixtures/packs/s127-demo-lib/2.0.0/package/*` | unpacked new tree |
| `cells/c04-source-acq/fixtures/packs/s127-demo-lib/0.9.0/version-document.json` | partial page |
| `cells/c04-source-acq/fixtures/packs/@s127/tiny/1.0.0/package/*` | scoped path |
| `cells/c04-source-acq/fixtures/tarballs/*.tgz` | full-tarball bytes |
| `cells/c04-source-acq/DONE.md` | this file |

## How to exercise

From repo root:

```
node --test experiments/s127-upgrade-impact/cells/c04-source-acq/acquire.test.mjs
```

Fixture acquire (no network):

```
node --input-type=module -e '
  import { acquire, acquirePair } from "./experiments/s127-upgrade-impact/src/acquire.mjs";
  const pair = await acquirePair({ name: "s127-demo-lib", oldVersion: "1.0.0", newVersion: "2.0.0", mode: "fixture", clock: "2026-09-10T12:00:00.000Z" });
  console.log(JSON.stringify({ old: pair.old.provenance, neu: pair.new.provenance, oldRoot: pair.old.rootDir, newRoot: pair.new.rootDir }, null, 2));
'
```

Rebuild stub tarballs after editing unpacked packs (still no npm):

```
node experiments/s127-upgrade-impact/cells/c04-source-acq/pack-fixtures.mjs
```

Live against the public registry is **not** part of the default exercise. Pass `mode: "live"` only when the integrator wants an optional free capture; record URL/time/sha/coverage and label `live-capture`.

## API (integrator)

```
acquire({
  name,                  // exact npm name; ranges throw
  version,               // exact semver; ^/~ / latest throw
  mode: "fixture"|"live", // default "fixture"
  fixtureRoot?, destDir?, clock?,
  fetchImpl?, timeoutMs?, maxBytes?,
  registry?,             // default https://registry.npmjs.org; http only for localhost
  expectedTarballSha256?
}) → {
  schema: "s127.upgrade-impact.acquire-result.v1",
  ok,                    // true only when coverage is "full tarball" and rootDir is set
  rootDir,               // directory containing package.json, or null
  provenance: {
    name, version, mode,
    label: "fixture"|"live-capture"|"synthetic",
    url, path, retrievedAt,
    sha256, contentSha256, sha256Of,
    coverage: "full tarball"|"partial page"|"missing",
    tarballPath, extracted,
    lifecycleScriptsRun: false,
    npmInstallRun: false,
    notes, error, extract
  }
}

acquirePair({ name, oldVersion, newVersion, mode, ... }) → { old, new }
```

`rootDir` for catalogued unpacked fixtures is the fixture `package/` path (treat as read-only). Tarball-only / live extracts go under `destDir` or `os.tmpdir()/s127-acquire/`.

## Limitations

- No live npmjs capture in this cell (`originalUrls` in `PROVENANCE.json` is empty). Tests mock live on 127.0.0.1.
- Exact versions only. Dist-tags and ranges are invalid input, not resolved.
- Default tarball cap 5 MiB, 2000 members, 15s timeout, version-document cap 1 MiB.
- Live tarball host must share the registry origin (no CDN hop).
- Redirects refused (`manual` + 3xx). Credentials and URL hashes refused.
- Symlinks in an acquired tree are refused after extract; this is not a full hostile-tarball suite (c14).
- Unpacked fixture `rootDir` is not copied; callers must not mutate it.
- Does not parse exports, bind usage, or emit `action|unknown|no_action`.
- `package.json` scripts in stubs would write `LIFECYCLE_RAN.txt` if executed; acquire must leave that file absent.
- TS / dynamic import analysis is out of scope (unknown for those cells).

## Open questions for integrator

1. Relocate stub packs to pack-level `fixtures/synthetic/` (c10) and pass `fixtureRoot`, or keep this cell path as the default?
2. Should unpacked fixtures be copied into `destDir` so later cells can write beside them?
3. Cache live extracts by tarball sha256 across runs, or always unique dest dirs?
4. Raise `maxBytes` for real cases A/B (c11/c12), and is npmjs the only live origin?
5. Identity mismatch: this cell returns `ok: false` + `partial page`. Confirm that maps to packet `unknown`.
6. `acquirePair` fetches old/new in parallel; should a missing old abort the new fetch?
7. Caller `sourceRoots[]` (git trees) are not acquired here — npm tarball/unpacked only.

## Evidence class

| Artifact | label | capturedFromLive |
| --- | --- | --- |
| stub packs and tarballs | `fixture` | false |
| mock-registry test | `live-capture` (runtime only, not stored) | n/a |
| npmjs.org | not captured | — |
