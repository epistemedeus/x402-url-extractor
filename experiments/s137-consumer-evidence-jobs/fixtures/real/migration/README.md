# Real docs migration fixture (x402 v1 → v2)

One public documentation pair for R2-CONSUMER-JOBS-01. Offline copy only.

Source: Apache-2.0 `x402-foundation/x402` at commit
`3c2ddfb922893c91ef8f281b64f8045d1f5e0d75` (committed `2026-09-09T15:17:16Z`).
Retrieved `2026-09-10T11:24:43Z`. Replay label: **fixture** (capture was live HTTPS GET).

| Role | Offline path | Upstream path |
| --- | --- | --- |
| old core | `source/old/x402-specification-v1.md` | `specs/x402-specification-v1.md` |
| old HTTP | `source/old/http-transport.md` | `specs/transports-v1/http.md` |
| new core | `source/new/x402-specification-v2.md` | `specs/x402-specification-v2.md` |
| new HTTP | `source/new/http-transport.md` | `specs/transports-v2/http.md` |

`input.json` is `s137.migration-checklist.input.v1` (oldDocs/newDocs/operations).
STATE inventory is omitted on purpose. Header names that are not HTTP routes
are in `observations.json` (positive / negative / partial / conflict, cited).
Field rename maps that the specs do not state are **not** recorded as facts.

Not captured: `specs/schemes/**`, MCP/A2A transports, `specs/extensions/bazaar.md`.
No paid endpoints. Not a license opinion or legal attestation.

Verify:

```sh
node --test experiments/s137-consumer-evidence-jobs/fixtures/real/migration/verify.test.mjs
```
