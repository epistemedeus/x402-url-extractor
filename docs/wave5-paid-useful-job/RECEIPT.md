# W5-H05 merchant lockfile pin-delta

Native Grok Heavy implementation. One feature branch, no production deploy.

## Outcome

Flag-gated `POST /lockfile-pin-delta` on the incumbent x402/MPP merchant.
Callers supply two npm lockfile JSON objects. The projected M03 engine
returns added/removed/changed pins. Identical pins are `informational`.
HTML, package.json, unsupported versions, SAMPLE, paths, and commands refuse
before payment. Replay binds method, URL, exact body, payer, terms, and
credential through the existing idempotency store.

## Pins

| Source | SHA |
| --- | --- |
| Merchant base | `a143898dd1ec35c097ca7eb0b472f30dad1ee319` |
| Engine | `fba9d14872bc4c04214e527b9edfb30c2123c9e7` `tools/lockfile-pin-delta/` |
| M01 catalog | `a20232b0f777b0f737cdffefb64a9ca9d9c9ba0e` |
| D01 contract (semantics only) | `6bed72dd22a396134aa5c957933b42c3a5746698` |

## Owned paths

- `vendor/lockfile-pin-delta/` (engine projection + NOTICE/PROVENANCE)
- `lockfile-pin-delta.mjs`, `lockfile-pin-delta-config.mjs`, `lockfile-pin-delta-worker.mjs`
- tests, buyer CLI, `docs/wave5-paid-useful-job/`
- wiring in `server.js` and existing discovery helpers

Unrelated routes and prices are unchanged. The signed deployment statement is
not rewritten.

## Tests executed

| Suite | Result |
| --- | --- |
| Engine CLI at `fba9d148` `tools/lockfile-pin-delta` | 29 pass |
| `lockfile-pin-delta.test.mjs` | 6 pass |
| `lockfile-pin-delta.http.test.mjs` + buyer CLI | 7 pass |
| `extract-batch.http.test.mjs` | 17 pass |
| `extract.http.test.mjs` | 1 pass |
| `replay-boundary.http.test.mjs` | 17 pass |
| `extract-batch.test.mjs` | 8 pass |
| `startup-smoke.test.mjs` | 2 pass |
| `service-deployment-publication.test.mjs` | still 25 signed routes |
| bazaar / MCP metadata / paid-effect / construction / machine-surface / OpenAPI / plugin / well-known-skills | pass |

No production settle. Facilitator was the existing injectable fake. No extra Bot or Cloud agent.
