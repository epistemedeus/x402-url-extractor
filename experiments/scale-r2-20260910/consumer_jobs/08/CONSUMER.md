# Fresh-consumer instructions — R2-CONSUMER-JOBS-08 (S152 compose)

Literal steps for a new consumer. No paid network calls. Synthetic fixtures only.
Fixture URLs stay **data** (never auto-fetched).

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/consumer_jobs/08
```

Requires Node ≥ 20. No `npm install` needed (pure Node ESM, zero dependencies).

## 2. Confirm siblings

```sh
ls ../07/src/cli.mjs
ls ../../../s137-consumer-evidence-jobs/scripts/cli.mjs
ls ../compose/src/cli.mjs
```

Heavy pack pin: `resolvedInputCommit=fa6878de125cfdcfd77f4b47037c88667090d293`.

## 3. Run focused tests

```sh
npm test
# compose + acquisition status (no Heavy re-run in status tests):
npm --prefix ../compose test
```

## 4. Manifest / journey / demo

```sh
node src/cli.mjs manifest   # readyCount: 7, pendingHeavyCount: 0
npm run journey             # writes demo-out/ and demo-out/s152/
npm run demo
```

## 5. Acquisition status (exact partial)

```sh
node ../compose/src/cli.mjs status --journey demo-out/s152/journey.json
```

Expect `packageStatus: "partial"` with failHeavy
`table-reconcile, link-index, replay-pack`. Status tool exit **0** on partial
(acquisition may proceed with eyes open). See `../compose/ACQUISITION.md`.

## What you get

Seven **ready recipes** wired to S137 + 07. Positive integrated journey is often
package **`partial`** because Heavy CLI returns fail for 03/04/05 — recorded as
external defects, **not** `unavailable_pending_heavy`. Non-pass Heavy decisions
are never invented as pass. **No** `investmentRecommendation`. No publication/payment.
