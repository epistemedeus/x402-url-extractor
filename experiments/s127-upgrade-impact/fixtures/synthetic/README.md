# S127 synthetic fixtures

Label: **`synthetic`**. These trees were authored for the upgrade-impact packet contract. They are not live-capture, not registry tarballs, and not paid demand.

Clock: `2026-09-10T12:00:00.000Z` (`CLOCK.txt`).

Package under test: `demo-widget` (private, unpublished).

## Required cases

| Id | Caller | Old → new tree | Expected `summary.nextAction` |
| --- | --- | --- | --- |
| `removed-export-used` | imports `alpha` | `1.0.0` → `2.0.0-removed-alpha` | `action` |
| `removed-export-unused` | imports `beta`/`gamma` only | same removal | `no_action` |
| `same-version-noop` | imports `alpha` | `1.0.0` → `1.0.0` | `no_action` |
| `partial-missing-source` | imports `alpha` | `1.0.0` → `2.0.0-partial` (no entry) | `unknown` |
| `dynamic-import` | `import("demo-widget")` | `1.0.0` → `2.0.0-removed-alpha` | `unknown` |
| `renamed-export` | imports `formatName` | `1.0.0` → `2.0.0-renamed` | `action` |
| `version-range-prerelease` | range `^1.0.0`, lock `2.0.0-beta.1` | `1.0.0` → `2.0.0-beta.1` (same exports) | `unknown` |

## Extra cases (still synthetic)

| Id | Why |
| --- | --- |
| `signature-changed` | used `beta` arity 1 → 2; coarse signature only |
| `workspace-alias` | `npm:` alias + `workspace:*`; identity unknown |

## Layout

- `packages/demo-widget/<tree>/` — mini old/new package trees
- `callers/<id>/` — synthetic caller projects (`package.json`, lockfile v3, `src/`)
- `cases/<id>.json` — case descriptors with expected decisions
- `goldens/` — end-to-end packet JSON (at least `removed-export-used`)
- `priors/` — immutable prior artifacts
- `PROVENANCE.json` — sha256 + label per artifact

`callers/removed-export-used/src/types.ts` is a type-only import. It must not be treated as a runtime use of a missing `Alpha` export; TypeScript coverage is unknown.

## Decision rules these fixtures pin

1. A newer version alone is not a break (`removed-export-unused`, `version-range-prerelease` exports).
2. An unused export change is not a caller defect (`removed-export-unused`).
3. Partial/missing source is `unknown`, not `action` (`partial-missing-source`).
4. Dynamic `import()` of the package is unknown for that surface (`dynamic-import`).
5. Alias/workspace/lockfile disagreement is unknown (`version-range-prerelease`, `workspace-alias`).
6. Same-version no-op is `no_action` (`same-version-noop`).
