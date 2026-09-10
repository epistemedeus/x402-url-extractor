# c16 DONE

Cell: `c16`  
Job: `R2-CONSUMER-JOBS-04` (link/artifact citation index)  
Schemas: `s137.link-index.input.v1` / `s137.link-index.output.v1`  
**evidenceClass:** synthetic (schema contract + in-module examples). Not live-capture. No paid endpoint.

## Files written

| Path | Role |
| --- | --- |
| `src/link-index/schema.mjs` | Input/output shapes, validators, field cites, pos/neg/partial/conflict examples, node:test self-run |
| `cells/c16/DONE.md` | this file |

Owned write path was `src/link-index/schema.mjs`. Did not write c17 transform, c18/c19 fixtures, or `test/link-index.test.mjs` (c20).

## Test command

From repo root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/src/link-index/schema.mjs
node experiments/s137-consumer-evidence-jobs/src/link-index/schema.mjs --self-check
```

Result: **12 pass, 0 fail**. Self-check `ok: true`.

Integrator:

```js
import {
  INPUT_SCHEMA,
  OUTPUT_SCHEMA,
  validateInput,
  validateOutput,
  createLinkIndexPacket,
  classifyHrefScheme,
} from "./src/link-index/schema.mjs";
```

## What the schema records

Sourced from `docs/OWNED-JOBS-01-06.json` (sha256 `240c9640f12d8212b5f6574cf2c5c5f0de6272fe675e7d916f0cf99e404a7bc3`) job outcome: bounded citation index from supplied HTML/Markdown with exact source anchors, unreachable targets and duplicates.

- Input: operator `clock`, `evidenceClass`, `documents[]` (html\|markdown + path/url + optional body/hash), optional `artifacts[]` inventory.
- Output packet: envelope from `src/packet.mjs` plus `anchors`, `links`, `targets`, `duplicates`, `unreachable`, `conflicts`, `citations`, cited `findings`.
- Reachability is inventory-only. `coverage.networkFetched` must be false.

Cases exercised:

| Kind | Input status | Output |
| --- | --- | --- |
| positive | ok | pass, one reachable relative href |
| negative | invalid (`now` clock, bad evidenceClass, empty documents; uncited finding) | invalid |
| partial | unknown (missing body; https not fetched) | partial |
| conflict | unknown (same path, two sha256s) | conflict |

## Limitations

- Does not parse HTML/Markdown (c17).
- Does not write synthetic/real fixtures or PROVENANCE (c18/c19).
- Does not read the filesystem or fetch URLs.
- Does not invent `clock`, `retrievedAt`, license, or hashes.
- Href identity is the exact written string; optional `normalized_href` duplicate match is recorded, not computed here.
- `javascript:` is hostile/invalid; `http(s)` without inventory is unknown (no fetch).
- Family tests live in c20.

## evidenceClass

`synthetic`
