# c14-hostile DONE

Cell: `c14-hostile`  
Pack: `experiments/s127-upgrade-impact`  
Clock: `2026-09-10T12:00:00.000Z`  
Evidence class: **fixture / synthetic**. Not live-capture. Not paid demand.

## Summary

Isolation contract for hostile upgrade-impact inputs is implemented and tested.

`scanHostileInputs({ packageRoot })` inspects an untrusted package tree with
`lstat` / `readFile` / `readlink` / `readdir` only. It never spawns a package
manager, never runs lifecycle scripts, never dynamically loads caller or
dependency sources, and never `realpath`-follows escaping symlinks.

| Case | Decision | nextAction | Finding |
| --- | --- | --- | --- |
| path-traversal | `invalid` | `unknown` | `path_traversal` |
| install-scripts | `unknown` | `unknown` | `lifecycle_scripts_present` (`executed: false`) |
| enormous-exports | `unknown` | `unknown` | `exports_map_oversize` (5001 keys, cap 1024; only `package.json` is read) |
| symlink-bomb | `invalid` | `unknown` | `symlink_escape` (`escape-link` → `/etc/passwd`; target not read) |
| conflicting-lockfile | `unknown` | `unknown` | `lockfile_disagreement` on synthetic `hostile-dep` (2.0.0 / 1.5.0 / 2.1.0) |
| binary-source | `unknown` | `unknown` | `binary_source` (PNG+NUL named `index.js`) |

Packet rules applied: conflicting/missing/partial source ⇒ `unknown` not
`action`; lockfile disagreement ⇒ `unknown`; a new version is not claimed as a
break; unused export change is not a caller defect; binary/unparseable source
is `unknown`.

Lifecycle scripts in `install-scripts/` only write `SCRIPT_RAN.marker` inside
that directory if executed. After analysis the marker is absent and
`globalThis.__C14_SCRIPT_RAN` is unset. `untrusted.tgz` is listed with `tar
-tzf` only.

Recursive zip/symlink bombs and tar-slip members were **described, not
created** (`fixtures/hostile/symlink-bomb/DESCRIPTION.md`). One out-of-tree
symlink and one in-tree symlink are enough to prove the refusal.

`node --test test/hostile.test.mjs`: **15/15 pass**.

## Files written

### Cell (`cells/c14-hostile/`)

- `index.mjs` — public exports
- `hostile-gate.mjs` — scanner
- `path-safety.mjs` — traversal / symlink target checks (no I/O on escaped paths)
- `script-policy.mjs` — lifecycle script names; never execute
- `source-kind.mjs` — binary vs UTF-8 (encoding only; no JS/TS parse)
- `exports-bounds.mjs` — `EXPORT_ENTRY_CAP=1024`, `EXPORT_TARGET_CAP=4096`
- `lockfile-conflict.mjs` — heuristic package-lock / yarn v1 / pnpm importer parse
- `spawn-guard.mjs` — in-process child_process block/record
- `pack-probe.mjs` — optional CLI probe; skipped until integrator wires `scripts/cli.mjs`
- `cases.mjs` — fixture map + expected findings
- `materialize.mjs` — generates enormous `package.json`, PNG `index.js`, escape symlink, tarball
- `README.md`
- `DONE.md` (this file)

### Fixtures (`fixtures/hostile/`)

- `README.md`, `MANIFEST.json`, `PROVENANCE.json` (`label: fixture`, `liveCapture: false`, `paidDemand: false`)
- `path-traversal/` — `main`/`exports`/`bin`/`files`/`typesVersions`/`imports` escape the package root
- `install-scripts/` — lifecycle scripts, `write-marker.mjs`, `untrusted.tgz`, `NEVER-EXECUTE.md`
- `enormous-exports/` — 5001 top-level `exports` keys, all pointing at in-tree `index.js`
- `symlink-bomb/` — `DESCRIPTION.md`; `escape-link` → `/etc/passwd`; `in-tree-link` → `package.json`
- `conflicting-lockfile/` — `package.json` 2.0.0 vs yarn 1.5.0 vs pnpm 2.1.0 (synthetic `hostile-dep`, never fetched)
- `binary-source/` — PNG+NUL bytes as `index.js`

### Tests

- `test/hostile.test.mjs` — isolation contract for all six cases; spawn guard; tar listing; optional pack probe

## How to exercise

From `experiments/s127-upgrade-impact`:

```bash
node --test test/hostile.test.mjs
node cells/c14-hostile/materialize.mjs
```

Scan one case:

```bash
node --input-type=module -e '
import { scanHostileInputs, casePath } from "./cells/c14-hostile/index.mjs";
console.log(JSON.stringify(scanHostileInputs({
  packageRoot: casePath("install-scripts"),
  clock: "2026-09-10T12:00:00.000Z",
  label: "fixture",
}), null, 2));
'
```

Integrator hook: call `scanHostileInputs` **before** acquire/install/bind.
If `inputValidity !== "ok"`, packet `summary.nextAction` must stay `unknown`
(or the input is `invalid`). Do not `npm install` these trees. Extract
`untrusted.tgz` with `tar` only.

`toPacketPatch(scan)` returns empty `bindings` and `actionableChanges` plus
the scan's `unknownReasons` / `limitations` for merge into
`s127.upgrade-impact.packet.v1`.

## Limitations

- This cell does **not** parse JS/TS module graphs (no acorn / es-module-lexer).
  Text vs binary is encoding/magic-bytes only. TS and dynamic `import()`
  contribution remain **unknown**.
- Yarn v1 stanza parser and pnpm importer-deps heuristic only. Yarn berry /
  pnpm lock v6+ / workspace aliases: **unknown** if they appear.
- `JSON.parse` still runs on `package.json` up to 512 KiB. The export cap
  stops per-entry file opens, not JSON parsing.
- Directory walk: 256 entries, depth 4, never follows symlinks. Deeper bombs
  would hit `walk_capped` → `unknown` (those bombs were not created).
- In-process `withSpawnGuard` cannot wrap a descendant of an already-spawned
  CLI. Pack probe checks `SCRIPT_RAN.marker` after an optional CLI run.
- Pack `src/` and `scripts/cli.mjs` were wired by sibling cells before this
  cell finished. The optional probe runs
  `scripts/cli.mjs analyze --manifest fixtures/hostile/install-scripts/package.json
  --source-root … --dep hostile-install-scripts --old/--new 0.0.0-synthetic
  --clock 2026-09-10T12:00:00.000Z --evidence-class fixture`. Observed: CLI
  packet `execute: false`, `offline: true`, spend $0; `SCRIPT_RAN.marker` still
  absent. This cell did not modify `src/` or `scripts/`.
- `hostile-dep` resolved URLs in lockfiles are synthetic strings. Never fetched.
- Path checks for Windows drive / UNC / percent-encoding are string-level on
  Linux; they do not emulate Win32 canonicalization.
- Install-script bodies are non-destructive (marker file only) so accidental
  execution cannot wipe the VM. Real malware would be worse; the test is the
  marker, not a claim that all scripts are safe.

## Open questions for integrator

1. Should `lifecycle_scripts_present_not_executed` always force packet-level
   `unknown`, even when `exports` are fully present in the tarball (no
   generated files)?
2. Should path traversal on unused fields (`types`, `browser`) invalidate the
   whole input, or become field-level `unknown` while `main` stays usable?
3. Confirm `EXPORT_ENTRY_CAP = 1024` (and 512 KiB manifest cap).
4. Should c04 refuse tarballs that declare lifecycle scripts, or extract with
   `tar` and run this gate?
5. Where to call `scanHostileInputs` relative to c01 normalize / c02 lockfile /
   c04 acquire / c06 bind?
6. Keep `bindings: []` here, or emit one `decision: unknown` row per declared
   export that was not analyzed?
7. CLI flag shape is now `analyze --manifest --source-root --dep --old --new --clock --evidence-class fixture`. Should the CLI refuse these hostile trees before acquire/bind, using `scanHostileInputs`?
8. Is an in-tree symlink to `package.json` informational only
   (`symlink_internal`), or should any symlink in a dep tarball be `unknown`?

## Negative evidence / kill condition

This cell does **not** invent paid demand. It does not demonstrate that
export-binding beats changelog skim on real packages A/B (c11/c12). It only
proves the analyzer can fail closed on hostile input.

No default-branch merge. No external posting. Spend $0.
