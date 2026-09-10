# c29 DONE

Cell: `c29`  
Owned path: `fixtures/real/freshness/`  
Job: R2-CONSUMER-JOBS-06 (dataset freshness receipt input)  
**evidenceClass:** `fixture` (HTTPS GET stored offline; not live-capture at replay)

## Files written

| Path | Role |
| --- | --- |
| `fixtures/real/freshness/nyc-311-erm2-nwe9.view.json` | official Socrata view metadata (25591 bytes) |
| `fixtures/real/freshness/http-headers.raw.txt` | curl `-D` headers (HTTP Date; no Last-Modified) |
| `fixtures/real/freshness/http-headers.json` | structured header parse |
| `fixtures/real/freshness/slim.json` | clocks + coverage extract + field map |
| `fixtures/real/freshness/input.json` | `s137.freshness-receipt.input.v1` packet |
| `fixtures/real/freshness/observations.json` | cited positive/negative/partial/conflict |
| `fixtures/real/freshness/PROVENANCE.json` | retrievedAt, url, sha256, license note |
| `fixtures/real/freshness/verify.test.mjs` | node:test hash + clock + citation checks |
| `fixtures/real/freshness/README.md` | replay notes |
| `cells/c29/DONE.md` | this file |

retrievedAt `2026-09-10T11:24:14Z`. sourceUpdatedAt `2026-09-10T01:38:08Z` (`rowsUpdatedAt`). viewLastModified `2025-12-29T15:25:00Z`.

## Test command

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/freshness/verify.test.mjs
```

9 pass, 0 fail (this cell). Offline after capture.

## Limitations

- One public dataset (NYC 311 view `erm2-nwe9`). Not a catalog-wide census.
- Metadata only; SODA row pages were not fetched.
- HTTP Date is retrieval time, not a publisher last-modified field. HTTP Last-Modified is absent.
- `license` / `licenseId` keys are absent; this is not a license grant or legal attestation.
- Native `rowsUpdatedAt` is mapped to input `sourceUpdatedAt`; original name is on `sourceUpdatedAtNativeField`.
- Portal usage counters in the raw JSON are not customer-demand claims.
- Transform lives in c27; job tests in c30.

## evidenceClass

`fixture`
