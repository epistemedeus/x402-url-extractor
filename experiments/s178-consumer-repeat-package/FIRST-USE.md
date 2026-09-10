# First use — S178 consumer-repeat package

Offline only. Node.js >= 22. No `npm install` of runtime deps. No paid or network execution.

## From this repository

```bash
cd experiments/s178-consumer-repeat-package
node bin/s178-cli.mjs list
node bin/s178-cli.mjs example release-brief --kind conflict
node bin/s178-cli.mjs run release-brief \
  --in ../../s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/cases/conflict-sha-mismatch.json \
  --clock 2026-09-10T18:00:00.000Z
```

`--clock` is required (operator ISO-8601). Do not invent time.

## Clean kit unpack

```bash
node scripts/build-kit.mjs
mkdir -p /tmp/s178-kit && tar -xzf dist/s178-consumer-repeat-kit.tgz -C /tmp/s178-kit
cd /tmp/s178-kit/s178-consumer-repeat-kit
node bin/s178-cli.mjs list
node bin/s178-cli.mjs run 07 --clock 2026-09-10T18:00:00.000Z
node bin/s178-cli.mjs run 03 --clock 2026-09-10T18:00:00.000Z --mode import
# decision=pass (table groups present; not an accepted-fail gate)
```

## Interpreting decisions

| decision | meaning |
| --- | --- |
| pass | Valid positive outcome |
| partial | Incomplete but usable; inspect `repeatInput` |
| conflict | Contradictory sources; not a pass |
| fail | Negative / rejected outcome |
| invalid | Bad input / schema rejection |
| unsupported | Missing dependency or out of scope |
| unknown | Undetermined |

`ok: true` means the runner completed honestly. It is **not** a pass claim.

## Jobs

01 migration-checklist · 02 release-brief · 03 table-reconcile · 04 link-index · 05 replay-pack · 06 freshness-receipt · 07 procurement-brief · 08 customer-result-package · acquire (compose status)

## Non-claims

No fabricated live customers, no implicit network/paid runs, no release claims, no new payments engine. SameDayDesk site pages remain S176-owned.
