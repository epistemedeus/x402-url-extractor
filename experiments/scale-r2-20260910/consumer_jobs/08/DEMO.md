# DEMO — R2-CONSUMER-JOBS-08

Truthful demo commands and expected shapes. Synthetic fixtures only.
Heavy 01–06 are **not** demoed with invented outputs.

## Commands

```sh
cd experiments/scale-r2-20260910/consumer_jobs/08
node src/cli.mjs manifest
node src/cli.mjs demo
node src/cli.mjs journey
node src/cli.mjs assemble fixtures/positive-journey.json
node src/cli.mjs assemble fixtures/partial-missing-heavy.json
node src/cli.mjs assemble fixtures/negative-unknown-recipe.json
npm test
```

## Expected demo summary shape

```json
{
  "schema": "x402.r2.consumer.customer_result_package.v1",
  "demo": true,
  "note": "Synthetic fixtures only; no live paid calls; Heavy 01–06 unavailable_pending_heavy.",
  "results": {
    "manifest.readyCount": 1,
    "manifest.pendingHeavyCount": 6,
    "positive-journey.json": {
      "status": "ready",
      "recipeStatuses": [{ "id": "procurement-brief", "status": "ready" }],
      "hasInvestmentRecommendation": false
    },
    "partial-missing-heavy.json": {
      "status": "partial",
      "recipeStatuses": [
        { "id": "procurement-brief", "status": "ready" },
        { "id": "heavy-01-evidence-capture", "status": "unavailable_pending_heavy" },
        { "id": "heavy-03-evidence-link", "status": "unavailable_pending_heavy" }
      ],
      "hasInvestmentRecommendation": false
    },
    "negative-unknown-recipe.json": {
      "status": "rejected",
      "recipeStatuses": [{ "id": "not-a-real-recipe-zzz", "status": "unknown" }],
      "hasInvestmentRecommendation": false
    }
  }
}
```

## Expected journey summary

`npm run journey` exits 0 and prints paths written under `demo-out/`, with
`positiveStatus: "ready"`, `partialStatus: "partial"`,
`negativeStatus: "rejected"`, `readyRecipes: 1`, `pendingHeavy: 6`.

Rejected assemble requests exit code `1`; demo/journey always exit `0` after reporting.
