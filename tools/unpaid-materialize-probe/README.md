# Unpaid materialization and wrapper-conformance probe

One-shot CLI that composes **existing** SameDayDesk states so an agent can tell
**validator acceptance** from **catalog reach**. It is not a hosted route, MCP
tool, collector, x402scan fork, cron job, or paid service.

Reuse, do not reimplement:

| Plane | Existing primitive |
|---|---|
| Provider eligibility vs catalog reach | `auditCoinbaseMaterialization` in `agent-discoverability-audit.mjs` |
| Exact-route listing identity | `evaluateListingIdentity` (`agent-payment-policy`) |
| Catalog vs live unpaid amount | `compareDiscoveryLive` in `discovery-drift.mjs` |
| Unpaid wrapper evidence | `charged:false` (same contract as `discovery-probe-gate.http.test.mjs`) |
| Catalog observation presence | bazaar-tracker **readback** states (`epistemedeus/samedaydesk` `tools/bazaar-tracker`, 13 tests) |

This kit never refreshes Bazaar as owner and never polls CDP. `--live`,
`--refresh`, `--cdp`, and `--poll` are refused.

## Operator commands

Copy-paste, unpaid, fixture-only:

```bash
node tools/unpaid-materialize-probe/cli.mjs seeded-absence
node tools/unpaid-materialize-probe/cli.mjs amount-mismatch
node tools/unpaid-materialize-probe/cli.mjs sds-extract-identity
```

Caller-supplied fixture:

```bash
node tools/unpaid-materialize-probe/cli.mjs replay --fixture tools/unpaid-materialize-probe/fixtures/seeded-absence.json
```

Exit **1** when the composed states show a catalog-reach gap, amount mismatch,
or wrapper `charged:true`. Exit **0** when listing identity is canonical, the
wrapper stays uncharged, and no mismatch is observed. Exit **2** for refused
flags or invalid usage. Bundled commands and `replay --fixture` of the same
file share that exit contract.

## Seeded cases

Each operator-surface fixture maps to one invariant. Replay of the fixture
file must produce the same exit and verdict as the bundled command (when one
exists).

| Command / fixture | Invariant | Exit |
|---|---|---|
| `seeded-absence` | `catalog-reach-gap`: validator-accepted unpaid 402 plus empty exact-resource search is `provider_accepted_not_materialized` / `route_absent`. Absence is not demand. | 1 |
| `amount-mismatch` | `amount-mismatch`: atomic catalog `5000` vs live unpaid `10000` is discovery-drift `mismatch`. Amounts are compared as strings. Units are not converted. | 1 |
| `sds-extract-identity` | `listing-identity-canonical`: SameDayDesk `/extract` listing identity is `canonical` at `https://agents.samedaydesk.com/extract`. Canonical origin match is not hostname-ownership proof. | 0 |
| `replay --fixture …/wrapper-charged-true.json` | `wrapper-charged-false`: unpaid wrapper evidence must stay `charged:false`. `charged:true` is `wrapper_nonconforming`. | 1 |

`--live`, `--refresh`, `--cdp`, and `--poll` remain refused (exit 2).

## Bazaar-tracker boundary

Read-only composition of SDS `tools/bazaar-tracker` compact observation
shape (`samedaydesk.bazaar-observation.v3`: resource URL plus digest). Pin
`775051602d91f42ca1aa920054cfd7a451982940`. Do not edit SDS. Do not run
`--live`. Do not treat a missing route as buyer demand.

## Tests

```bash
node --test tools/unpaid-materialize-probe/test.mjs
```
