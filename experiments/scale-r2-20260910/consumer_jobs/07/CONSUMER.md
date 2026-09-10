# Fresh-consumer instructions — R2-CONSUMER-JOBS-07

Literal steps for a new consumer. No paid network calls. Synthetic fixtures only.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/consumer_jobs/07
```

Requires Node ≥ 20. No `npm install` needed (pure Node ESM, zero dependencies).

## 2. Run the focused test suite

```sh
npm test
# equivalent: node --test tests/*.test.mjs
```

Expect positive / negative / partial cases to pass.

## 3. Run the truthful demo

```sh
npm run demo
# equivalent: node src/cli.mjs demo
```

Demo walks all fixtures and prints status + price/free states. It never claims
an investment recommendation.

## 4. Build a brief from a fixture

```sh
node src/cli.mjs brief fixtures/positive.json
node src/cli.mjs brief fixtures/partial-missing-price.json
node src/cli.mjs brief fixtures/external-cost.json
```

Or pipe JSON on stdin:

```sh
cat fixtures/partial-unavailable-free.json | node src/cli.mjs brief -
```

## 5. Validate input only

```sh
node src/cli.mjs validate fixtures/positive.json
```

## 6. Supply your own dry-run input

Provide JSON with:

- `taskId` (string)
- `taskNeeds.musts[]` and/or `capabilityIds[]` / `outcomes[]`
- `serviceContracts[]` each with `contractId`, covered capabilities/outcomes,
  optional `price.amountAtomic`, `priceSource`, `externalCosts[]`,
  `freeBaseline.{freeAlternativeState,freeAlternativeBasisId}`, `evidenceRefs[]`

Forbidden on any object: ranking/reputation/invest/revenue/escrow/custody fields
(see `src/constants.mjs` `FORBIDDEN_FIELDS`).

## What you get

A brief with `comparisons[]` (need coverage + `priceState` + free baseline) and
a factual `summary` of counts. **No** `investmentRecommendation` field.
