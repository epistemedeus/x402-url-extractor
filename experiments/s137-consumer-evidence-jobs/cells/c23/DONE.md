# c23 DONE

Cell: `c23`  
Owns: `fixtures/synthetic/replay-pack/`  
Job: R2-CONSUMER-JOBS-05 (API example replay pack)  
**evidenceClass:** `synthetic`

## Summary

Synthetic OpenAPI 3.1.0 documents plus companion example files for offline, no-spend replay packaging. Cases pin `expectedDecision` only; c21/c22 own schema/transform. Lab host is `https://api.example.test` (not fetched). HTTP 402 is a refusal marker, not an executable offer.

Pattern sources (read-only): in-repo unpaid `page-change-http.mjs` OpenAPI companion (request example, no 200 example) and `src/packet.mjs` citation envelope. OAS 3.1 Example Object field names `value` / `externalValue` as already used by in-repo `openapi: "3.1.0"` documents; spec URL not fetched.

## Files written

| Path | Role |
| --- | --- |
| `fixtures/synthetic/replay-pack/CLOCK.txt` | Operator clock `2026-09-10T12:00:00.000Z` |
| `fixtures/synthetic/replay-pack/MANIFEST.json` | Catalog of six cases |
| `fixtures/synthetic/replay-pack/PROVENANCE.json` | sha256, license note, pattern-source hashes |
| `fixtures/synthetic/replay-pack/README.md` | Fresh-consumer instructions |
| `fixtures/synthetic/replay-pack/hash.mjs` | sha256 helpers |
| `fixtures/synthetic/replay-pack/load.mjs` | Catalog/case/example loaders |
| `fixtures/synthetic/replay-pack/materialize.mjs` | Idempotent writer |
| `fixtures/synthetic/replay-pack/self-test.mjs` | node:test integrity |
| `fixtures/synthetic/replay-pack/cases/positive-unpaid-complete/` | positive / pass |
| `fixtures/synthetic/replay-pack/cases/negative-missing-examples/` | negative / fail |
| `fixtures/synthetic/replay-pack/cases/negative-paid-marker/` | negative / fail (402, no spend) |
| `fixtures/synthetic/replay-pack/cases/partial-mixed-operations/` | partial |
| `fixtures/synthetic/replay-pack/cases/conflict-example-mismatch/` | conflict (do not merge) |
| `fixtures/synthetic/replay-pack/cases/partial-external-value/` | partial (unfetched `externalValue`) |
| `cells/c23/DONE.md` | this file |

25 files under owned path plus this DONE.md (26).

## Test command

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/self-test.mjs
```

Result: **10 pass, 0 fail**.

Optional regenerate:

```bash
node experiments/s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/materialize.mjs
```

## Limitations

- Synthetic only. Not a live official API snapshot (c24).
- Does not implement replay-pack schema or transform (c21/c22).
- Does not fetch `servers[].url` or Example Object `externalValue`.
- Does not copy payment code or execute paid endpoints.
- Case documents pin `expectedDecision`; integrator tests live in c25.

## evidenceClass

`synthetic`
