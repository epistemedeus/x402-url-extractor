# c06 DONE

Cell: `c06`  
Job: `R2-CONSUMER-JOBS-02` release evidence brief schema  
evidenceClass: **synthetic** (no live-capture, no paid endpoint)

## Files written

| Path | Role |
| --- | --- |
| `src/release-brief/schema.mjs` | Input/brief schemas, plane catalogs, validators, synthetic pos/neg/partial/conflict cases, node:test |
| `cells/c06/DONE.md` | this file |

Owned write path only. Did not write `transform.mjs` (c07), `fixtures/synthetic/release-brief/` (c08), `fixtures/real/release-brief/` + PROVENANCE (c09), or `test/release-brief.test.mjs` (c10).

## Test command

From repo root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/src/release-brief/schema.mjs
node experiments/s137-consumer-evidence-jobs/src/release-brief/schema.mjs --self-check
```

8 node:test pass; 16 catalog cases (positive, negative, partial, conflict).

## What the schema enforces

- Planes `announced | shipped | tested` stay separate. Changelog / release-notes kinds cannot sit on shipped or tested.
- Compound `github-release` must split notes from tag/commit/artifact fields. Draft cannot carry shipped identity. Release-note `body` on shipped is `plane_conflation`.
- Findings and plane items require `citationIds` into `citations[]` with path or url; fixture/live-capture also require content sha256.
- `decision: pass` requires aligned identities on all three planes. Missing tested is `partial`. Identity disagreement is `conflict`.
- Operator clock required (ISO-8601; `"now"` refused). `payment.attempted` and legal/demand/oracle claims stay false.

## Limitations

- Validates shapes and plane separation only; does not parse git, npm, CI, or changelog prose.
- Wording such as "shipped" or "tested" inside notes is announced-only (transform c07 maps bytes).
- Does not invent clock, spend, demand, or legal attestation.
- Does not fetch network sources.
- Real GitHub/npm captures and `PROVENANCE.json` belong to c09.
- Catalog cases are synthetic (`synthetic://` locators), not live-capture.

## Integrator notes (c07 / c08 / c10)

```js
import {
  INPUT_SCHEMA, BRIEF_SCHEMA, PLANES, LANES, SOURCE_KINDS,
  validateInput, validateOutput, impliedDecision, schemaCases,
} from "./src/release-brief/schema.mjs";
```

`lane` is an alias of `plane` (c08 fixtures). Announced `target_commitish` is a claim, including branch names such as `master` in the c09 express snapshot.
