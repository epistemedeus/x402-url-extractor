# c07-unknown-partial DONE

Cell: `c07-unknown-partial`  
Pack: `experiments/s127-upgrade-impact`  
Schema: `s127.upgrade-impact.unknown.v1`

## Summary

Centralized the S127 unknown/partial taxonomy in `src/unknown.mjs`. Eight reason codes map to a decision policy of **force unknown** vs **allow partial bindings with flags**. The module constrains candidate bindings from c06; it does not invent export diffs, usage, paid demand, or a break from “a newer version exists”.

| code | policy | effect |
| --- | --- | --- |
| `missing_source` | force_unknown | packet `nextAction=unknown`; all `action` → `unknown` |
| `partial_coverage` | allow_partial | covered used symbols may stay `action`; uncovered → `unknown` |
| `lockfile_conflict` | force_unknown | identity untrusted until c02 resolves disagreement |
| `dynamic_import` | allow_partial | named specifier/surface unknown; other surfaces may bind |
| `unsupported_language` | allow_partial | named files unknown; JS/JSX may bind |
| `parser_limit` | allow_partial | TS / type-only / SFC / unhandled syntax unknown |
| `prerelease_range_ambiguous` | force_unknown | range/dist-tag/unpinned prerelease without exact `resolved*` |
| `hostile_input` | force_unknown | no action; no execution; `flags.hostile` |

Unnamed `allow_partial` (no `symbols`/`surfaces`/`files`/`modules` and no `covered*` lists) **escalates** to `force_unknown` because coverage cannot be proven.

Packet reduction (`applyUnknownPolicy` / `evaluateUnknown`):

1. Repair `used:false` + `decision:action` → `no_action` (unused export change is not a caller defect).
2. Downgrade `action` on any binding a reason applies to.
3. Any effective `force_unknown` reason → packet `unknown` and empty `actionableChanges`.
4. Else if any binding remains `action` → packet `action`, while `unknownReasons` still lists partial flags.
5. Else if unknown bindings remain, or a reason is not accounted as unused → `unknown`.
6. Else → `no_action`.

`force_unknown` never emits `action`. It does not rewrite `no_action`.

## Files written

Owned paths only:

- `experiments/s127-upgrade-impact/src/unknown.mjs`
- `experiments/s127-upgrade-impact/cells/c07-unknown-partial/CONTRACT.md`
- `experiments/s127-upgrade-impact/cells/c07-unknown-partial/unknown.test.mjs`
- `experiments/s127-upgrade-impact/cells/c07-unknown-partial/fixtures/taxonomy.synthetic.json`
- `experiments/s127-upgrade-impact/cells/c07-unknown-partial/DONE.md` (this file)

## How to exercise

Isolation tests (node:test, no network, no `npm install`):

```bash
cd /tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact
node --test cells/c07-unknown-partial/unknown.test.mjs
```

Last run: **51 pass / 0 fail**.

REPL check that named partial coverage keeps a covered used removal as `action` while an uncovered used symbol is `unknown`:

```bash
cd /tmp/s127/x402-url-extractor/experiments/s127-upgrade-impact
node --input-type=module -e '
import { applyUnknownPolicy, classifyPartialCoverage } from "./src/unknown.mjs";
console.log(JSON.stringify(applyUnknownPolicy({
  bindings: [
    { symbol: "alpha", used: true, changeKind: "removed", decision: "action" },
    { symbol: "beta", used: true, changeKind: "removed", decision: "action" },
  ],
  reasons: [classifyPartialCoverage({
    coverage: 0.5,
    coveredSymbols: ["alpha"],
    evidenceClass: "synthetic",
  })],
}).summary, null, 2));
'
```

Expected summary: `nextAction: "action"`, `unknownReasons: ["partial_coverage"]`, `actionableChanges: ["alpha"]`.

Integrator API: import from `src/unknown.mjs`. Policy table: `cells/c07-unknown-partial/CONTRACT.md`.

## Fixture vs live-capture

All cell evidence is **synthetic**.

- `cells/c07-unknown-partial/fixtures/taxonomy.synthetic.json` — label `synthetic`, clock `2026-09-10T12:00:00.000Z` (same string as pack `fixtures/synthetic/CLOCK.txt`). No URL, no content hash of an upstream registry, no live GET.
- Tests construct in-memory bindings (demo-widget `alpha`/`beta` as names only). They do not read c10/c11/c12 trees, so this cell does not race those writers.
- No live-capture. No paid demand. No payment/cost/execute fields on the result object.

## Limitations

- Not a parser. TS/dynamic/SFC limits are labeled `parser_limit` / unknown; this pack does not claim full TypeScript program analysis.
- Not a lockfile solver. `lockfile_conflict` requires an explicit disagreement signal from c02 (manifest range vs lock exact is **not** treated as conflict here).
- Not the usage binder. Missing `decision` on a binding defaults to `unknown`; this module will not invent `action`.
- Classifiers do not scan hostile payloads; they accept signals already classified by c14.
- Unnamed partial/dynamic/language reasons escalate to force_unknown (conservative).
- `coverage: 0` with an artifact present is `partial_coverage`, not `missing_source`. Callers must send `missing_source` when the artifact is absent.
- Bare dist-tags (`latest`, `beta`) are ranges; `2.0.0-beta.1` with exact `resolved*` is a pin and is not ambiguous.
- JSX is treated as supported (c03’s parser choice). `.vue` / `.svelte` / `.ts` / `.tsx` are `parser_limit`.
- No runtime execution of package modules or lifecycle scripts.
- Packet `nextAction` may be `action` while `unknownReasons` is non-empty when only `allow_partial` reasons apply. Completeness is not implied.

## Open questions for integrator

1. **Packet `nextAction` with mixed action + unknown bindings.** This cell allows `nextAction=action` plus `unknownReasons` for named `allow_partial` (so a confirmed used-export removal is not swallowed by an unrelated dynamic import). If product policy is “any unknown surface ⇒ packet unknown”, c09 should AND that in. Contract rule 3 is stricter for missing/conflicting/partial **source**; unnamed `partial_coverage` already escalates.
2. **Should c06 emit unknown bindings for named surfaces that have no row?** Example: `dynamic_import` of `lazy-plugin` with no binding. This cell lists the reason but does not synthesize a binding. Packet `no_action` is blocked unless that surface is accounted as `used:false`.
3. **Same-version + `missing_source`.** Rule 6 says same-version/no-op ⇒ `no_action`. This module still forbids `action` under `missing_source` but will not itself short-circuit to `no_action`. c01/c06 should skip bind or pass `no_action` bindings when identity is trusted and versions match.
4. **TS that es-module-lexer can still read.** If c03 extracts static ESM names from `.ts`, attach `parser_limit` only to unparsed constructs (`import type`, enums, etc.), not to every symbol in the file.
5. **Who stamps `evidenceClass` / provenance sha?** c04. This module only passes `evidenceClass` through (`fixture` | `live-capture` | `synthetic`).
6. **c10 fixture reuse.** Isolation tests do not import `fixtures/synthetic/` so they stay hermetic. c10 may copy `taxonomy.synthetic.json` or import `REASON_CODES` from `src/unknown.mjs`.
7. **Hostile signal vocabulary.** `HOSTILE_SIGNAL_CODES` is a starter list. c14 may add signals; unknown extra signal strings still force `hostile_input`.

## Outputs

- Canonical reason codes: `REASON_CODES` / `TAXONOMY` in `src/unknown.mjs`
- Policy application: `applyUnknownPolicy` → `{ schema, reasons, bindings, summary, limitations, flags }`
- Classifiers: one per reason family (`classifyMissingSource`, `classifyPartialCoverage`, `classifyLockfileConflict`, `classifyDynamicImport`, `classifyLanguage` / `classifyParserLimit` / `classifyUnsupportedLanguage`, `classifyPrereleaseRange`, `classifyHostileInput`)
- Draft collector: `collectReasonsFromDraft`
- Isolation proof: `cells/c07-unknown-partial/unknown.test.mjs` (51 tests, each reason code covered)
