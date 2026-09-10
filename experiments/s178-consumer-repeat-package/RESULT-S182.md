# S182 — merchant consumer outcome repair

Branch: `codex/s182-consumer-outcome-repair-20260910`
Base: S178 tip `1886ef731a2b0dd1f37df2f6586682962a69cbb1`
Frozen S174 tip (untouched): `3876fced28e9c9fc4411695eee2f0f275edc63f7` on `codex/s174-consumer-final-cli-fix-20260910`

## Defect

S178 acceptance greenwashed advertised positives: `cli_positive_*` accepted every decision, `import_positive_*` only required `ok:true`, directory import was vacuous, and jobs 03/04/05 stayed `fail` because S137 CLI was fed fixture wrappers/directories instead of schema-valid transform input.

## Fix

Explicit adapters (`src/adapters/`) — one file per artifact, named exports only, no heuristic fallthrough:

| Job | Adapter | Transform export | Positive input coercion |
| --- | --- | --- | --- |
| 01 | `s137-migration.mjs` | `transformMigrationChecklist` | case spec + fixture root |
| 02 | `s137-release-brief.mjs` | `buildReleaseBrief` | unwrap `.input` envelope |
| 03 | `s137-table-reconcile.mjs` | `reconcileTables` | `loadCase` + `toSchemaInput` (bodies, not paths) |
| 04 | `s137-link-index.mjs` | `transform` | case dir → documents[] + artifacts[] with schema-safe ids |
| 05 | `s137-replay-pack.mjs` | `transform` | case dir → examples[] + citations |
| 06 | `s137-freshness.mjs` | `buildFreshnessReceipt` | `coerceToSchemaInput` |
| 07 | `job07.mjs` | `buildProcurementBrief` | JSON as-is |
| 08 | `job08.mjs` | `assembleCustomerResultPackage` | JSON as-is |
| acquire | `compose-acquire.mjs` | `acquisitionStatusFromPath` | content-discriminated journey vs package (`--type` optional) |

CLI and import share `adapter.execute`. `ok:true` is honest completion; `decision` is the business outcome. Schema rejection cannot promote a false pass (S174); conflict/partial/fail stay.

## 03 / 04 / 05 classification

All three were **adapter/shape bugs**, not unsupported jobs:

- 03: case JSON listed table *paths* without row bodies → `invalid:missing-body`. Coerce via `toSchemaInput` → **pass** with agree groups.
- 04: directory fixtures never became `documents[]`. Loader + valid artifact ids → **pass** with cited links.
- 05: directory/case.json is not `examples[]`. Materialize from OpenAPI companions → **pass** with offline examples.

They remain advertised ready jobs. No accepted-fail gates.

## Verification

- `node test/acceptance.test.mjs` → **OK 0 failures**
- Exact positives: 01–08 `pass` (acquire `partial` = acquisition-ok)
- Exact partial/negative/conflict per catalog
- S174: conflict-sha-mismatch `conflict`; partial stays partial; malformed-wrapper not pass
- S174 pack `release-brief-cli-regression.test.mjs` 6/6
- Clean unpack of `dist/s178-consumer-repeat-kit.tgz`: 01–08 pass, acquire partial, conflict=conflict, renamed rejected-package still fail (content, not filename)
- Kit sha256: `bdd693ab38e5d5b8092cd4333cec6bd2872207f6d8c64ccd6e4fb1b5a155cb70`

## Non-claims

Offline only. No fabricated network/prices/revenue. No new payment engine. No SameDayDesk (S176) writes. No default merge/deploy. Frozen S174 tip not rewritten.
