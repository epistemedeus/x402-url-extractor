# Expected APIs (c10 test contract)

Two layers:

1. **Catalog / goldens / decision rules** (`test/*.test.mjs` except `src-modules.test.mjs`) always run against the cell stub in `lib/`. That pins PACKET-CONTRACT.md to the synthetic fixtures even while sibling `src/` export names differ.
2. **`test/src-modules.test.mjs`** calls live `src/*.mjs` with *their* public names against the same fixtures. Soft-skip if a file is missing.

Schema id: `s127.upgrade-impact.packet.v1`  
Clock must be injected. Do not invent `Date.now()` when clock is missing — fail instead.

## Live src names (as of sibling cells)

| File | Public entry | Notes vs stub |
| --- | --- | --- |
| `src/normalize.mjs` | `normalizeCallerInput` | Missing clock → `ok: false`, `status: "invalid"` |
| `src/lockfile.mjs` | `resolveCallerDependency`, `rangeSatisfaction` | Prerelease vs `^1.0.0` → unknown / not `match` |
| `src/imports.mjs` | `analyzeStaticImports` | Usage rows use `names[]`, `dynamicImport` |
| `src/acquire.mjs` | `acquire` / `acquirePair` | Fixture-catalog oriented; synthetic trees are local dirs |
| `src/export-diff.mjs` | `diffExports({ oldRoot, newRoot, clock })` | `exportDiff.removed[].name`; rename heuristic is conservative |
| `src/bind.mjs` | `bind` / `bindUsageToExportDiff` | `summary.nextAction` may be `review_breakages` (CLI maps to `action`) |
| `src/unknown.mjs` | `applyUnknownPolicy` | Reason codes: `missing_source`, `partial_coverage`, `lockfile_conflict`, `dynamic_import`, … |
| `src/prior.mjs` | `loadPrior`, `assertImmutable`, `writeSequencedPrior` | Schema `s127.upgrade-impact.prior.v1` |
| `scripts/cli.mjs` | `analyze --dep --old --new --clock --fixture-old --fixture-new` | c09 |

## Stub names (catalog goldens)

These are the names the isolation stub and `composePacket` use. Integrator may keep them as aliases.

## `src/normalize.mjs`

`normalizeInput(input) → { ok, code?, message?, caller, dependency, clock, evidenceClass, errors[] }`

Required input: `clock`, `caller.manifestPath` (or `manifestPath`), `dependency.name`.  
`evidenceClass` is `fixture` | `live-capture` | `synthetic`. Missing clock → `ok: false`, `code: "missing_clock"`.

## `src/lockfile.mjs`

`resolveDependency({ lockfilePath, manifestPath, name }) → { ok, name, requestedRange, resolved, aliases[], workspace, disagreements[], unknownReasons[], limitations[] }`

`rangeSatisfies(range, version) → { ok, unknown, reason? }`  
Disagreement kinds used by fixtures: `lockfile_range_disagreement`, `alias_or_workspace`, `workspace_protocol`, `npm_alias`.

## `src/imports.mjs`

`analyzeImports(sourceRoots, packageName, options?) → { usage[], coverage, limitations[] }`

Usage row: `{ specifier, symbol, kind, file, dynamicImport, typeOnly? }`.  
`kind`: `named` | `default` | `namespace` | `side_effect` | `dynamic`.  
`dynamicImport: true` ⇒ unknown contribution for that surface.  
`.ts`/`.tsx` and `import type` are not full TS analysis; type-only is not runtime use.

## `src/acquire.mjs`

`acquirePackageTree({ path, url?, label, retrievedAt, coverage? }) → { ok, treePath, entryPath, files[], provenance[], treeSha256, coverage, limitations[] }`

Local paths only in these tests. Never run package lifecycle scripts. Coverage `full` | `partial` | `unknown`.

## `src/export-diff.mjs`

`diffExports(oldTree, newTree) → { added[], removed[], renamed[]?, signatureChanged[]?, coverage, limitations[] }`

`oldTree`/`newTree` may be acquire results or filesystem paths.  
Rename is a heuristic (1:1 removed/added with equal arity). Ambiguous pairs stay added+removed.  
Arity is a coarse signature; TypeScript types are unknown.

## `src/bind.mjs`

`bindUsageToDiff({ usage, exportDiff, dependency }) → { bindings[], unknownReasons[] }`

Binding: `{ symbol, used, changeKind, decision, rationale, dynamicImport? }`.  
`changeKind`: `added` | `removed` | `renamed` | `signatureChanged` | `unchanged` | `unknown`.  
`decision`: `action` | `unknown` | `no_action`.

## `src/unknown.mjs`

`applyUnknownRules({ bindings, exportDiff, usage, lockfile, acquire, dependency, limitations? }) → { bindings, unknownReasons, limitations }`

Overlays packet-contract rules 3–6: partial source, dynamic import, alias/workspace/lockfile disagreement, same-version no-op. Demotes `action` to `unknown` when the overlay forbids a claim.

## `src/prior.mjs`

- `loadPrior(path)`
- `attachPrior(packet, priorLoad)`
- `applyCorrection(packet, correction)`
- `assertImmutable(path, nextBytes)`
- `writeSequencedArtifact(dir, stem, sequence, body)`

Priors are immutable. Corrections write `seq-N+1`. Schema `s127.upgrade-impact.prior.v1`.

## Compose (test harness; may live in CLI later)

`composePacket(input, impl?)` in the cell stub. Optional `src/packet.mjs` with the same export is used when present.

Input: `{ clock, evidenceClass, caller, dependency: { name, oldVersion, newVersion, oldTree, newTree }, priorPath?, packRoot? }`.

## Decision rules (non-negotiable)

1. Newer version alone ≠ break.
2. Unused export change ≠ caller defect.
3. Conflicting/missing/partial source ⇒ `unknown`, not `action`.
4. Dynamic import of package ⇒ unknown for that surface.
5. Alias/workspace/lockfile disagreement ⇒ unknown until resolved or reported.
6. Same-version/no-op ⇒ `no_action`.
