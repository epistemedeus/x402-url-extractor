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

After a `paid_success` v1 row is written, the merchant hashes the same
`res.write`/`end` bytes already used for `responseDigest` and appends
`http-response-validation.v1.ndjson`. Measurement failure never starts payment,
changes amount, turns an error into success, or retries unknown settlement.

Join: `method` + `route`/`resource` + `responseDigest`.

Old records without a sibling row remain `not_checked` / unknown. No backfill
of private bodies.

## Migration

- v1 paid-success file is unchanged (`commerce-paid-success-evidence.ndjson`).
- New optional file: `http-response-validation.v1.ndjson`.
- Do not add validator fields to v1 rows (that would drop historical records).
