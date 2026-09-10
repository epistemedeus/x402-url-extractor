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
```

Heavy pack pin: `resolvedInputCommit=fa6878de125cfdcfd77f4b47037c88667090d293`.

## 3. Run focused tests

```sh
npm test
# compose surface:
npm --prefix ../compose test
```

## 4. Manifest / journey / demo

```sh
node src/cli.mjs manifest   # readyCount: 7
npm run journey             # writes demo-out/ and demo-out/s152/
npm run demo
```

## What you get

Seven ready recipes: Heavy 01–06 (`s137.consumer-evidence.packet.v1` via S137 CLI)
plus `procurement-brief` (07). Non-pass Heavy decisions are recorded as returned —
never invented as pass. **No** `investmentRecommendation`. No publication/payment.
