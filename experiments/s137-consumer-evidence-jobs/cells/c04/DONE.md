# c04 DONE

Cell: `c04`  
Owned path: `fixtures/real/migration/`  
Job: R2-CONSUMER-JOBS-01 (documentation migration checklist input)  
**evidenceClass:** `fixture` (HTTPS GET stored offline; not live-capture at replay)

## Files written

| Path | Role |
| --- | --- |
| `fixtures/real/migration/source/old/x402-specification-v1.md` | old core spec |
| `fixtures/real/migration/source/old/http-transport.md` | old HTTP transport |
| `fixtures/real/migration/source/new/x402-specification-v2.md` | new core spec |
| `fixtures/real/migration/source/new/http-transport.md` | new HTTP transport |
| `fixtures/real/migration/source/license/LICENSE` | Apache-2.0 text |
| `fixtures/real/migration/source/license/NOTICE` | copyright notice |
| `fixtures/real/migration/source/specs-README.md` | specs folder index |
| `fixtures/real/migration/PROVENANCE.json` | urls, retrievedAt, sha256, license note |
| `fixtures/real/migration/input.json` | old/new docs + caller operation inventory |
| `fixtures/real/migration/observations.json` | cited positive/negative/partial/conflict |
| `fixtures/real/migration/verify.test.mjs` | node:test hash + citation checks |
| `fixtures/real/migration/README.md` | replay notes |
| `cells/c04/DONE.md` | this file |

Pinned: `x402-foundation/x402@3c2ddfb922893c91ef8f281b64f8045d1f5e0d75`.  
retrievedAt `2026-09-10T11:24:43Z`. sourceCommitDate `2026-09-09T15:17:16Z`.

## Test command

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/migration/verify.test.mjs
```

11 pass, 0 fail (this cell). Offline after capture. Input validates against c01 `s137.migration-checklist.input.v1` with coverage `partial` because STATE inventory is omitted, not invented.

## Limitations

- One public pair only (HTTP + core spec). MCP/A2A transports and `specs/schemes/**` / `specs/extensions/bazaar.md` were not retrieved.
- Observations do not invent field or header renames. Parallel names (`X-PAYMENT` vs `PAYMENT-SIGNATURE`, `maxAmountRequired` vs `amount`) stay unknown unless a captured document states the map.
- Caller inventory is extracted from the v1 docs, not a production trace.
- License copy is not a legal attestation.
- No paid endpoints. Transform lives in c02; job tests in c05.
