# c03 DONE

Cell: `c03`  
Owns: `fixtures/synthetic/migration/`  
Job: R2-CONSUMER-JOBS-01 (documentation migration checklist)  
**evidenceClass:** `synthetic`

## Summary

Synthetic old/new docs plus caller operation inventories for a cited migration checklist. Cases pin expected `decision` and cited findings only; c01/c02 own schema/transform. Routes and phrases are excerpted from this repository (`SOURCE-PINS.json`); conflict is the HTTP-vs-`mcp://` challengeResource disagreement already present in README/`mcp-server.mjs` vs `mcp-typed-telemetry-producer.mjs`.

## Files written

| Path | Role |
| --- | --- |
| `fixtures/synthetic/migration/CLOCK.txt` | Operator clock `2026-09-10T12:00:00.000Z` |
| `fixtures/synthetic/migration/MANIFEST.json` | Catalog of five cases |
| `fixtures/synthetic/migration/README.md` | Table format and case map |
| `fixtures/synthetic/migration/SOURCE-PINS.json` | Repo path + excerpt pins |
| `fixtures/synthetic/migration/PROVENANCE.json` | sha256 + license note |
| `fixtures/synthetic/migration/catalog.test.mjs` | node:test catalog integrity |
| `fixtures/synthetic/migration/cases/positive-complete.json` | positive / pass |
| `fixtures/synthetic/migration/cases/negative-missing-new-docs.json` | negative / fail (absent new docs) |
| `fixtures/synthetic/migration/cases/negative-malformed-inventory.json` | negative / fail (inventory shape) |
| `fixtures/synthetic/migration/cases/partial-batch-undocumented.json` | partial (`extract_batch` missing in new) |
| `fixtures/synthetic/migration/cases/conflict-challenge-resource.json` | conflict (do not pick a winner) |
| `fixtures/synthetic/migration/docs/*/` | old/new markdown + inventory JSON |
| `cells/c03/DONE.md` | this file |

26 files under owned path plus this DONE.md (27).

## Test command

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/migration/catalog.test.mjs
```

Result: **8 pass, 0 fail**.

## Limitations

- Synthetic only. Not a live public-docs snapshot (c04).
- Does not implement migration-checklist schema or transform (c01/c02).
- Does not parse OpenAPI or run Goose/Hermes discovery.
- Does not copy payment code or execute paid endpoints.
- Expected findings are catalog pins for c05; this cell does not emit packets.

## evidenceClass

`synthetic`
