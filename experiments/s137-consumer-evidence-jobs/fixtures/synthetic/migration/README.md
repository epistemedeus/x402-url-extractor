# Synthetic migration-checklist fixtures

Label: **`synthetic`**. Authored old/new doc pairs and caller operation
inventories for R2-CONSUMER-JOBS-01. Not live-capture. Not paid demand.
Clock: `2026-09-10T12:00:00.000Z` (`CLOCK.txt`).

Job outcome (from owned portfolio): turn supplied old/new docs and a caller
operation inventory into a cited migration checklist. These fixtures pin the
four required case kinds for that transform. They do not run the transform
(c02) and do not define the schema module (c01).

## Documented-operations table

Docs under `docs/` use one GitHub-flavored table whose header is exactly:

```
| method | route | mcpTool | challengeResource | availability |
```

A following separator row, then one row per operation. Empty cells are
missing (unknown). `availability` is `always` or `flag:EXTRACT_BATCH_ENABLED`.

Caller inventories are JSON with schema `s137.migration.inventory.v1`.

## Required cases

| Id | Kind | Expected `decision` | Why |
| --- | --- | --- | --- |
| `positive-complete` | positive | `pass` | Inventory GET `/extract` and GET `/read` are cited in both old and new tables; new adds unused `POST /extract/batch`. |
| `negative-missing-new-docs` | negative | `fail` | Case lists a new-docs path that is not present. |
| `negative-malformed-inventory` | negative | `fail` | Inventory `operations` is not an array of `{method,route}`. |
| `partial-batch-undocumented` | partial | `partial` | Inventory includes `extract_batch`; new table omits it. |
| `conflict-challenge-resource` | conflict | `conflict` | Two new docs disagree on `challengeResource` for `POST /extract/batch`. |

## Source-informed, not invented

Phrases and routes are excerpted from this repository. See `SOURCE-PINS.json`.
The conflict case is the real tension between:

- payment challenge bound to the HTTP resource, not `mcp://` (`README.md`, `mcp-server.mjs`)
- telemetry product `resource` still labeled `mcp://tool/extract_batch` (`mcp-typed-telemetry-producer.mjs`)

The checklist must surface that disagreement. It must not pick a winner.

## Layout

- `cases/<id>.json` — case descriptor, expected decision, cited findings
- `docs/<id>/` — old/new markdown and inventory JSON
- `SOURCE-PINS.json` — repo path + excerpt that must still appear in that file
- `PROVENANCE.json` — sha256 of authored artifacts
- `catalog.test.mjs` — node:test catalog integrity (not the c05 transform suite)

## Exercise

From repository root:

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/migration/catalog.test.mjs
```
