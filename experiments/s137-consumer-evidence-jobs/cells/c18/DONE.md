# c18 DONE

Cell: `c18`  
Owns: `fixtures/synthetic/link-index/`  
Job: R2-CONSUMER-JOBS-04 (link-to-artifact index)  
**evidenceClass:** `synthetic`

## Summary

Synthetic HTML/Markdown entries plus in-tree artifacts for a bounded citation index. Cases pin literal link markup, target status, and cited findings; c16/c17 own schema/transform. External `example.invalid` URLs and path escapes are not fetched.

## Files written

| Path | Role |
| --- | --- |
| `fixtures/synthetic/link-index/CLOCK.txt` | Operator clock `2026-09-10T12:00:00.000Z` |
| `fixtures/synthetic/link-index/MANIFEST.json` | Catalog of eight cases |
| `fixtures/synthetic/link-index/README.md` | Inventory rules and case map |
| `fixtures/synthetic/link-index/catalog.mjs` | Loader + quoted-href / MD inventory |
| `fixtures/synthetic/link-index/self-test.mjs` | node:test integrity |
| `fixtures/synthetic/link-index/PROVENANCE.json` | sha256 + license note |
| `fixtures/synthetic/link-index/cases/positive-html/` | positive / pass |
| `fixtures/synthetic/link-index/cases/positive-md/` | positive / pass |
| `fixtures/synthetic/link-index/cases/negative-empty/` | negative / fail |
| `fixtures/synthetic/link-index/cases/negative-no-links/` | negative / fail |
| `fixtures/synthetic/link-index/cases/negative-malformed/` | negative / fail |
| `fixtures/synthetic/link-index/cases/partial-mixed/` | partial (missing file/fragment, external, escape) |
| `fixtures/synthetic/link-index/cases/conflict-duplicates/` | conflict (same text, two hrefs) |
| `fixtures/synthetic/link-index/cases/conflict-duplicate-ids/` | conflict (duplicate `id=install`) |
| `cells/c18/DONE.md` | this file |

29 files under owned path plus this DONE.md (30).

## Test command

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/link-index/self-test.mjs
```

Result: **8 pass, 0 fail**.

## Limitations

- Synthetic only. Not a live public-page snapshot (c19).
- Does not implement link-index schema or transform (c16/c17).
- Inventory is double-quoted HTML hrefs, markdown inline/reference links, HTML ids, and a subset ATX slug. Not a browser or CommonMark parser.
- Does not fetch `https://example.invalid/...` or open `../outside.md`.
- Expected findings are catalog pins for c20; this cell does not emit packets.

## evidenceClass

`synthetic`
