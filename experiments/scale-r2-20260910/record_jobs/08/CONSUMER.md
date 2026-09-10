# Fresh-consumer instructions — R2-RECORD-JOBS-08

Literal steps for a new consumer. No live paid calls. Synthetic fixtures only.
Heavy 01..04 are **not** reimplemented here.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/record_jobs/08
```

Requires Node ≥ 20. No `npm install` needed (pure Node ESM, zero dependencies).

## 2. (Optional) Confirm sibling record jobs 05..07

On the Pilot VM these absolute worktrees are preferred when present:

```sh
ls /workspace/pilot/worktrees/r2-record-jobs-05-20260910/experiments/scale-r2-20260910/record_jobs/05/src/index.mjs
ls /workspace/pilot/worktrees/r2-record-jobs-06-20260910/experiments/scale-r2-20260910/record_jobs/06/src/index.mjs
ls /workspace/pilot/worktrees/r2-record-jobs-07-20260910/experiments/scale-r2-20260910/record_jobs/07/src/index.mjs
```

If a sibling is missing, the bundle still validates the embedded fixture shape and
marks that slot `unavailable_sibling` — it does **not** invent a report.

## 3. Run the focused test suite

```sh
npm test
# equivalent: node --test tests/*.test.mjs
```

Expect positive / partial / negative cases to pass.

## 4. List the job manifest

```sh
node src/cli.mjs bundle
```

Expect `readyCount: 3` (route-regression, deadline-calendar, dependency-footprint)
and `ownedByHeavyCount: 4`.

## 5. Run the truthful demo

```sh
npm run demo
# equivalent: node src/cli.mjs demo
```

Writes under `demo-out/` (gitignored except `.gitkeep`):

- `journey.json`, `manifest.json`, `positive.json`, `partial.json`,
  `negative.json`, `unknown.json`

## 6. Run a bundle request

```sh
node src/cli.mjs run fixtures/positive-bundle.json
node src/cli.mjs run fixtures/partial-missing-sibling.json
node src/cli.mjs run fixtures/negative-forbidden.json
node src/cli.mjs run fixtures/negative-unknown-job.json
```

Or pipe JSON on stdin:

```sh
cat fixtures/positive-bundle.json | node src/cli.mjs run -
```

## 7. Validate request only

```sh
node src/cli.mjs validate fixtures/positive-bundle.json
```

## What you get

A bundle with `jobs[]` slots. When siblings are present, nested outputs use the
real 05/06/07 schemas. Heavy stubs stay `owned_by_heavy` with `output: null`.
**No** `investmentRecommendation` (and `hasInvestmentRecommendation: false`).
