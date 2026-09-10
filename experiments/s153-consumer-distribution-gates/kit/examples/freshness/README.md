# Real freshness snapshot (S137 c29)

**evidenceClass:** `fixture` (one HTTPS GET stored offline; replay is not live-capture).

Job: `R2-CONSUMER-JOBS-06` dataset freshness receipt.

Source: NYC Open Data Socrata view metadata
`https://data.cityofnewyork.us/api/views/erm2-nwe9.json`
(311 Service Requests from 2020 to Present, id `erm2-nwe9`).

| Clock | Value | Native field |
| --- | --- | --- |
| download / retrieval | `2026-09-10T11:24:14Z` | HTTP `Date` |
| source row update | `2026-09-10T01:38:08Z` | `rowsUpdatedAt` |
| catalog/view metadata | `2025-12-29T15:25:00Z` | `viewLastModified` |
| created | `2011-10-10T05:52:17Z` | `createdAt` (unknown slot in c26) |

HTTP `Last-Modified` is absent. `license` / `licenseId` keys are absent. Row payload was not fetched.

## Test

```
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/freshness/verify.test.mjs
```

Do not re-fetch as part of the test command.
