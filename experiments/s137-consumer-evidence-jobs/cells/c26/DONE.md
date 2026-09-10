# c26 DONE

Cell: `c26`  
Job: `R2-CONSUMER-JOBS-06` dataset freshness receipt schema  
Schema: `s137.freshness-receipt.input.v1` / `s137.freshness-receipt.v1`  
evidenceClass: **fixture** (offline; values copied from cited S122/S127/local files). Not live-capture. No spend.

## Files written

| Path | Role |
| --- | --- |
| `src/freshness-receipt/schema.mjs` | Owned schema: time-kind vocabulary, input/receipt/PROVENANCE validation, ages without fallback |
| `cells/c26/schema.test.mjs` | node:test positive/negative/partial/conflict |
| `cells/c26/DONE.md` | this file |

Did not write `transform.mjs` (c27), `fixtures/synthetic/freshness/` (c28), `fixtures/real/freshness/` (c29), or `test/freshness-receipt.test.mjs` (c30).

## Test command

From repo root `/tmp/s137/x402-url-extractor`:

```bash
node --test experiments/s137-consumer-evidence-jobs/cells/c26/schema.test.mjs
```

Recorded: **17 pass, 0 fail** (Node v22.23.2). Offline. No network.

## Contract (download time ≠ source update time)

- Download slot fields: `retrievedAt`, `capturedAt`/`capturedAtUtc`, `catalogObservedAt`, `liveObservedAt`.
- Source-update slot fields: `time.modified`, `time.<version>`, `published_at`, `lastUpdated`/`catalogLastUpdated`, `Last-Modified`.
- HTTP `Date`, filesystem `mtime`, npm `time.created`, and operator `clock`/`now` do not fill either slot.
- `downloadAgeMs = clock - downloadedAt`. `sourceAgeMs = clock - sourceUpdatedAt`. Neither is computed from the other field.
- `lagAtDownloadMs = downloadedAt - sourceUpdatedAt` only when both slots exist.
- Missing one time → `partial`. Disagreeing same-kind times → `conflict`. Future vs clock → `unknown` ages. `'now'` refused.
- Findings require `citationIds` into `citations[]` (path or url; contentSha256 when present).

## Limitations

- Schema/validation only; no fetch and no live observation.
- No legal attestation of freshness; no paid endpoints; no customer-demand claims.
- Ambiguous names (`createdAt`, `updatedAt`, `Age`) stay unknown.
- Without `horizonMs`, numeric ages do not yield current/stale.
- Example instants are copied from cited fixtures; this cell does not vendor those files.

## Integrator notes

```js
import { validateInput, validateReceipt, EXAMPLE_CASES } from "./src/freshness-receipt/schema.mjs";
```

c27 should emit findings from `validateInput` slots and must not invent missing times from clock.
