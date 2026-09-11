# Seam decision

No existing hosted merchant route compares two caller-supplied npm
`package-lock.json` objects. `GET /extract` fetches a URL. `POST /extract/batch`
fetches URLs. `POST /recipes/page-change` is an unpaid companion that diffs
already delivered extract-batch artifacts. `GET /schemaforge` emits JSON-LD.
None of those is lockfile pin-delta.

W5-M01 selected `lockfile-pin-delta` as the first useful supplied-input offer.
The engine is a local CLI. This change adds a flag-gated HTTP adapter on the
incumbent merchant payment, receipt, replay, OpenAPI, and MCP stack.

Not built: a second payment rail, job platform, SDS52 runner, or a copy of the
SameDayDesk repository. The engine is a source projection at
`vendor/lockfile-pin-delta/` from `epistemedeus/samedaydesk`
`fba9d14872bc4c04214e527b9edfb30c2123c9e7`.
