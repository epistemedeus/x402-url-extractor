# S178 — consumer-repeat package (complete merchant kit)

## Branch / head

- Branch: `codex/s178-consumer-repeat-package-20260910`
- Base: `origin/master` @ `a20c6e2d8cd716498dfe1c8d0f34985039df64cc`
- Tip: see `git rev-parse HEAD` on this branch after push

## Preserved frozen S174 tip (S179 / 6Pro review)

- Branch: `codex/s174-consumer-final-cli-fix-20260910`
- Tip: `3876fced28e9c9fc4411695eee2f0f275edc63f7`
- Not rewritten. S178 is a fresh branch off current default.

## Exact pins composed

| Source | SHA | Path |
| --- | --- | --- |
| S174 (01–06 + S153 kit lineage) | `3876fced28e9c9fc4411695eee2f0f275edc63f7` | `experiments/s137-consumer-evidence-jobs`, `experiments/s153-consumer-distribution-gates` |
| Bot 07 | `b1b0db112985ee06b625ef1bef8c8770e336ce25` | `experiments/scale-r2-20260910/consumer_jobs/07` |
| Bot 08 | `6d1376c8f1561114bf632bd437d54343b7d1894c` | `experiments/scale-r2-20260910/consumer_jobs/08` |
| S170 recheck compose | `c36eff932c983d9ad06cd6d6e5ea8466f457c1e4` | `experiments/scale-r2-20260910/consumer_jobs/compose` |

## Deliverable

`experiments/s178-consumer-repeat-package/` — externally usable offline consumer-job package:

- Shared discovery (`src/catalog.mjs`), result contract (`src/contract.mjs`), runner (`src/run-job.mjs`), CLI (`bin/s178-cli.mjs`)
- Jobs 01–08 + compose `acquire` status
- Product examples: positive / material partial-or-negative / repeat-input per job
- S174 release-brief `conflict-sha-mismatch` regression preserved (CLI + import → `conflict`, not pass)
- Clean kit: `dist/s178-consumer-repeat-kit.tgz` (Node >=22, no private receipts/logs)

## First-use (cold agent)

```bash
cd experiments/s178-consumer-repeat-package
node bin/s178-cli.mjs list
node bin/s178-cli.mjs run release-brief --clock 2026-09-10T18:00:00.000Z
node bin/s178-cli.mjs run release-brief \
  --in ../s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/cases/conflict-sha-mismatch.json \
  --clock 2026-09-10T18:00:00.000Z
# decision=conflict

node scripts/build-kit.mjs
mkdir -p /tmp/s178-kit && tar -xzf dist/s178-consumer-repeat-kit.tgz -C /tmp/s178-kit
cd /tmp/s178-kit/s178-consumer-repeat-kit
node bin/s178-cli.mjs run 07 --clock 2026-09-10T18:00:00.000Z
node bin/s178-cli.mjs run acquire --clock 2026-09-10T18:00:00.000Z
# decision=partial, ok=true (honest; 03/04/05 remain failed slots)
```

`ok:true` means honest completion, not business pass. See `FIRST-USE.md`.

## Verification

- Acceptance: `node test/acceptance.test.mjs` → OK 0 failures (Node v22)
- Clean unpack kit: list / release-brief pass / conflict / 07 pass / acquire partial
- Kit sha256: see `dist/SHA256.txt` after build

## Small owner fixes

- `08` exports `DEFAULT_OPERATOR_CLOCK`, `HEAVY_RECIPE_IDS`, extended `RECIPE_STATUS`, `SIBLING_S137_*`, `runHeavyAnalyzeRecipe` compatibility shims for compose
- Compose CLI JSON slice fix in S178 runner; kit path mirrors for `vendor/07|08` and root `s137-consumer-evidence-jobs`

## Unresolved true gates

- Jobs 03/04/05 still return `fail` on some synthetic positives via Heavy CLI (recorded honestly in acquire `partial`; not greenwashed)
- Compose green-bundle / deferred-recheck remain larger API surface than thin Bot-08; status/acquire is the supported buyer entry
- SameDayDesk site integration remains S176-owned (untouched)
- No default merge/deploy; draft feature PR only

## Concurrency / Heavy

- Cursor = control transport + implementation owner for this outcome-complete branch
- Same Heavy parent after S174 not resumed as interactive TUI (S174 tip frozen for 6Pro); no quota-filler sessions; no overage/reset
- Useful concurrency evidence this wave: sequential owned compose (distinct module scopes planned; Heavy capacity reserved rather than parallel filler children)
- Historical capacity sample from S153 preserved elsewhere: peak ~49 OS `grok --cwd`; native-child canary remains S137=2

## Non-claims

No fabricated live sources/customers; no implicit network/paid execution; no release claims; no new payments engine; existing paid endpoint semantics/prices unchanged.
