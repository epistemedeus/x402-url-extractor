# c07 unknown/partial taxonomy

Module: `src/unknown.mjs`  
Schema: `s127.upgrade-impact.unknown.v1`  
Evidence in this cell: **synthetic** (no live-capture, no paid demand).

Integrator (c06 bind, c09 CLI, c10 tests) should treat this file as the reason-code authority.

## Reason codes and policy

| code | catalog policy | default scope | packet `nextAction` | bindings |
| --- | --- | --- | --- | --- |
| `missing_source` | `force_unknown` | packet | `unknown` | every `action` → `unknown` |
| `partial_coverage` | `allow_partial` | surface | `action` allowed on **covered** used symbols | uncovered / not-covered → `unknown` |
| `lockfile_conflict` | `force_unknown` | packet | `unknown` | every `action` → `unknown` |
| `dynamic_import` | `allow_partial` | surface | `action` allowed on other surfaces | named specifier/surface → `unknown` |
| `unsupported_language` | `allow_partial` | artifact | `action` allowed on supported files | named files → `unknown` |
| `parser_limit` | `allow_partial` | artifact | `action` allowed on parsed files | named files/symbols → `unknown` |
| `prerelease_range_ambiguous` | `force_unknown` | packet | `unknown` | every `action` → `unknown` |
| `hostile_input` | `force_unknown` | packet | `unknown` | every `action` → `unknown`; `flags.hostile` |

Unnamed `allow_partial` (no `symbols` / `surfaces` / `files` / `modules` and no `covered*` lists) **escalates** to `force_unknown` (`escalated: true`, `escalateReason: "unnamed_scope"`). Coverage that cannot be named cannot be proven.

`force_unknown` never emits `action`. It does **not** rewrite `no_action` (unused export change is still not a caller defect). Packet `nextAction` is still `unknown` while a force reason is present.

## Packet reduction (`applyUnknownPolicy` / `evaluateUnknown`)

1. Repair illegal `used: false` + `decision: action` → `no_action`.
2. Downgrade `action` on any binding a reason applies to.
3. If any effective `force_unknown` reason exists → `summary.nextAction = unknown` and `actionableChanges = []`.
4. Else if any binding remains `action` → `summary.nextAction = action` (packet may still list `unknownReasons` for partial flags).
5. Else if any binding is `unknown` or a reason is not accounted as unused → `unknown`.
6. Else → `no_action`.

`summary` shape matches the packet contract: `{ nextAction, unknownReasons[], unusedChanges[], actionableChanges[] }`.

## Classifiers (optional; c02/c03/c04/c14 may emit reasons directly)

| helper | emits |
| --- | --- |
| `classifyMissingSource` | `missing_source` when old/new artifact is explicitly absent |
| `classifyPartialCoverage` | `partial_coverage` when coverage is not complete |
| `classifyLockfileConflict` | `lockfile_conflict` only on an **explicit** disagreement signal (does not re-implement semver satisfies) |
| `classifyDynamicImport` | `dynamic_import` when `dynamicImport: true` |
| `classifyLanguage` / `classifyParserLimit` / `classifyUnsupportedLanguage` | `parser_limit` or `unsupported_language` |
| `classifyPrereleaseRange` | `prerelease_range_ambiguous` unless both sides pin exact or prerelease-exact identity (`resolved*` wins over declared ranges) |
| `classifyHostileInput` | `hostile_input` from flags/signals already classified by c14; does not scan payloads |

`collectReasonsFromDraft(draft)` runs the above on a partial packet.

## Non-goals

- Not the usage binder (c06) and not export-diff (c05).
- Does not claim full TypeScript analysis.
- Does not execute package scripts or follow hostile paths.
- A new version is not itself a break; this module will not turn empty bindings into `action`.
