# Synthetic OpenAPI replay-pack fixtures (S137 c23)

Label: **`synthetic`**. Authored lab OpenAPI 3.1.0 documents plus companion example files for R2-CONSUMER-JOBS-05. Not live-capture. Not a real provider snapshot (that is c24). No spend.

Clock: `2026-09-10T12:00:00.000Z` (`CLOCK.txt`). Operator-supplied. Do not replace with `now`.

Lab server: `https://api.example.test` (reserved). Do not fetch.

## Fresh-consumer

From repository root:

```bash
node experiments/s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/materialize.mjs
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/self-test.mjs
```

`materialize.mjs` is idempotent. Default tests are offline.

## Cases

| Id | Kind | expectedDecision | Why |
| --- | --- | --- | --- |
| `positive-unpaid-complete` | positive | pass | GET `/v0/status` named example matches companion body. Unpaid. |
| `negative-missing-examples` | negative | fail | Valid OpenAPI, no `example`/`examples`. Do not invent bytes. |
| `negative-paid-marker` | negative | fail | HTTP 402 listed. Do not treat as executed provider result. No spend. |
| `partial-mixed-operations` | partial | partial | POST request example only; GET health complete. Pattern from in-repo unpaid page-change OpenAPI. |
| `conflict-example-mismatch` | conflict | conflict | OpenAPI `ok: true` vs companion `ok: false`. Do not merge. |
| `partial-external-value` | partial | partial | Example Object `externalValue` not fetched. Online prereq explicit. |

## Layout

- `cases/<id>/openapi.json` — synthetic OpenAPI 3.1.0
- `cases/<id>/examples/*.json` — companion example files when present
- `cases/<id>/case.json` — cited findings, `onlinePrerequisites`, `expectedDecision`
- `MANIFEST.json` — catalog
- `PROVENANCE.json` — sha256 per file, license note, pattern-source hashes

Every finding has `citationIds` into `citations[]` (path or url, sha256 when bytes exist).
