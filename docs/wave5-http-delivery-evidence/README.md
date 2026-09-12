# HTTP delivery evidence (observational)

Versioned sibling of paid-success capture. Schema
`samedaydesk.wave5.d17.http-response-validation.v1`.

This is **not** buyer-attested usefulness, independent demand, or revenue.
Schema pass is not a sold outcome. Historical v1 paid-success rows stay
`validatorVerdict: not_checked`.

## Contracts (live same-repo)

| Route | HTTP body contract |
| --- | --- |
| `GET /extract` | `extractMcpOutputSchema` (Zod; HTTP and MCP share this object) |
| `GET /read` | `readMcpOutputSchema` |
| `POST /extract/batch` | `extractBatchOutputSchema()` JSON Schema, **not** MCP Zod |
| `POST /lockfile-pin-delta` | `lockfilePinDeltaOutputSchema()` JSON Schema |

Generated JSON under `http-delivery-evidence/canonical-contracts.generated.json`
is a pin-time snapshot for equivalence tests. Production binds the live exports.

## Capture

After a `paid_success` v1 row is written, the merchant hashes every transferred
byte into the same `responseDigest` and may retain a **copied** prefix of at
most 10 MiB for supported routes only (`GET /extract`, `GET /read`,
`POST /extract/batch`, `POST /lockfile-pin-delta`). Unsupported paid routes
hash without retaining body bytes.

Fields:

- `responseByteLength` — actual transferred length
- `retainedByteLength` — stored prefix length (`<= 10 MiB`)
- `responseDigest` — digest of the **full** transferred body, never of a prefix
- `paidEvidenceId` — the v1 paid-success `id` (UUID)

Measurement failure never starts payment, changes amount, turns an error into
success, or retries unknown settlement.

## Identity and join

Each historical v1 row is identified by its durable event `id`. `join()` emits
**one row per historical `id`**. `joinKey(method, route, responseDigest)` is
diagnostic only and must not drop purchases that share a body digest.

A validation attaches only when `paidEvidenceId === historical.id` **and**
`responseDigest === historical.responseDigest`. Body-only matches, missing ids,
or conflicting ids never borrow another purchase's validation. Same-id replay
may accumulate observations for that id. Different ids with identical bodies
stay separate. Unmatched historical rows remain `not_checked` / unknown.

## Migration

- v1 paid-success file is never rewritten (`commerce-paid-success-evidence.ndjson`).
- New optional file: `http-response-validation.v1.ndjson`.
- Do not add validator fields to v1 rows (that would drop historical records).
