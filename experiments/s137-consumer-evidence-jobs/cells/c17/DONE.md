# c17 DONE

Cell: `c17`  
Owns: `src/link-index/transform.mjs`  
Job: R2-CONSUMER-JOBS-04 (link-to-artifact index)  
Depends on: c16 `src/link-index/schema.mjs`  
**evidenceClass:** `synthetic` for schema/self-check cases; real README replay is `fixture`. No live GET in this cell.

## Summary

`transformLinkIndex(input)` / `transform(input)` turn supplied HTML/Markdown documents plus an artifact inventory into `s137.link-index.output.v1`:

- Exact source anchors: `startOffset` / `endOffset` / `line` / `column` / `hrefExact`
- Inventory-only reachability (no fetch)
- Unreachable: `missing_artifact`, `missing_fragment`, `empty_href`
- Duplicates: `exact_href` groups
- Conflicts: disagreeing artifact hashes, duplicate fragment ids, same link text bound to different hashed artifacts

Operator `clock` is required. `"now"` is refused. `javascript:` is never reachable. `http(s)` is `unknown` unless the URL is in the inventory.

## Files written

| Path | Role |
| --- | --- |
| `src/link-index/transform.mjs` | Transform + node:test / `--self-check` |
| `cells/c17/DONE.md` | this file |

Did not write c16 schema, c18/c19 fixtures, or `test/link-index.test.mjs` (c20).

## Test command

From repository root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/src/link-index/transform.mjs
node experiments/s137-consumer-evidence-jobs/src/link-index/transform.mjs --self-check
```

Result: **12 pass, 0 fail**. `--self-check` `ok: true`.

Integrator:

```js
import { transform, transformLinkIndex } from "./src/link-index/transform.mjs";
const packet = transform(input);
// packet.links[].anchorId → packet.anchors[]
// packet.unreachable[] / packet.duplicates[] / packet.conflicts[]
// packet.findings[].citationIds → packet.citations[]
```

## Cases covered

| Kind | Source | Decision |
| --- | --- | --- |
| positive | c16 example `./spec.md`; synthetic HTML/MD fixtures | `pass` |
| negative | missing/`now` clock; empty docs; empty file; bare URL; empty href | invalid or `fail` |
| partial | mixed reachable/missing/external/escape; `maxLinks` truncation; real README | `partial` |
| conflict | disagreeing artifact hashes; duplicate `id=install`; same text → two artifacts | `conflict` |

## Limitations

- Not a DOM or CommonMark parser. Quoted HTML href/id; markdown inline/reference/wrapped image-link.
- Heading slugs: lowercase, punctuation stripped, whitespace to hyphen. Not github-slugger.
- Fenced code and `<script>`/`<style>` masked. Autolinks and unquoted hrefs are not indexed.
- Reachability is the supplied inventory only. Relative targets on the one-page real README are `missing_artifact`.
- Schema `conflicts[]` requires two artifact ids and two disagreeing hashes; text-target clashes use those artifact hashes.
- No paid endpoint, legal attestation, customer-demand claim, or network fetch.

## evidenceClass

`synthetic` (transform contract + authored fixtures). Real page replay labeled `fixture`.
