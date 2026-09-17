# Unpaid `POST /lockfile-pin-delta` fixtures

Additive fixtures for the unpaid materialize probe. They pin the live unpaid
challenge and classify an empty exact-resource catalog search as
`route_absent`, not buyer demand.

R6-03's extract `seeded-absence` fixture is a different origin and route. Do
not reuse it as this POST. This directory does not pay, publish, refresh
Bazaar as owner, or poll CDP.

Live unpaid facts cited here (2026-09-17T12:38:37Z, no `PAYMENT-SIGNATURE`):

| probe | result |
|---|---|
| `POST /lockfile-pin-delta` | HTTP 402, `accepts[].amount` `5000`, no `WWW-Authenticate` |
| `GET /lockfile-pin-delta` | HTTP 404 |
| MCP `lockfile_pin_delta` | `_meta.x402.paymentRequired` true, amount `5000` |

## Operator commands

Copy-paste, unpaid, fixture-only:

```bash
node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs empty-search
node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs treat-absence-as-demand
node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs amount-mismatch
node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs invented-field
node tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.mjs unpaid-402
```

`empty-search` and `unpaid-402` exit **1** with `code: route_absent`. Validator
acceptance plus `catalogSearch.resources=[]` is not demand.

Seeded failures also exit **1**:

- `treat-absence-as-demand` → `treat_absence_as_demand`
- `amount-mismatch` → live `10000` vs expected `5000`
- `invented-field` → `loyaltyPoints`, `throughBlock`

`--live`, `--refresh`, `--cdp`, `--poll`, and `--pay` are refused (exit 2).

If R6-03's probe CLI is present, the same JSON is replayable:

```bash
node tools/unpaid-materialize-probe/cli.mjs replay --fixture \
  tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/empty-search.json
```

## Tests

```bash
node --test tools/unpaid-materialize-probe/fixtures/lockfile-pin-delta/check.test.mjs
```
