# Fresh-consumer instructions — R2-CONSUMER-JOBS-08

Literal steps for a new consumer. No paid network calls. Synthetic fixtures only.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/consumer_jobs/08
```

Requires Node ≥ 20. No `npm install` needed (pure Node ESM, zero dependencies).
Optional: `npm install` is a no-op for deps and is safe if your habit is always
to install first.

```sh
npm install
```

## 2. Confirm sibling 07 (ready recipe dependency)

This thin package prefers the sibling tree:

```sh
ls ../07/src/cli.mjs
```

On branch `codex/r2-consumer-jobs-08-20260910` both `consumer_jobs/07` and
`consumer_jobs/08` are present (07 merged in). If `../07` is missing, the
assembler reports `missing_dependency` rather than inventing a brief.

## 3. Run the focused test suite

```sh
npm test
# equivalent: node --test tests/*.test.mjs
```

Expect positive / partial / negative cases to pass.

## 4. List the recipe manifest

```sh
node src/cli.mjs manifest
```

Expect `readyCount: 1` (procurement-brief) and `pendingHeavyCount: 6`.

## 5. Run the clean-install journey

```sh
npm run journey
# equivalent: node src/cli.mjs journey
```

Writes under `demo-out/` (gitignored except `.gitkeep`):

- `journey.json`
- `manifest.json`
- `positive.json`
- `partial.json`
- `negative.json`

## 6. Run the truthful demo

```sh
npm run demo
# equivalent: node src/cli.mjs demo
```

## 7. Assemble a single request

```sh
node src/cli.mjs assemble fixtures/positive-journey.json
node src/cli.mjs assemble fixtures/partial-missing-heavy.json
node src/cli.mjs assemble fixtures/negative-unknown-recipe.json
```

Or pipe JSON on stdin:

```sh
cat fixtures/positive-journey.json | node src/cli.mjs assemble -
```

## What you get

A package with `recipes[]` slots. Ready recipes may include nested 07 brief
output. Heavy slots remain `unavailable_pending_heavy`. **No**
`investmentRecommendation` field (and `hasInvestmentRecommendation: false`).
