# DEMO — R2-CONSUMER-JOBS-07

Truthful demo commands and expected shapes. Synthetic fixtures only.

## Commands

```sh
cd experiments/scale-r2-20260910/consumer_jobs/07
node src/cli.mjs demo
node src/cli.mjs brief fixtures/positive.json
node src/cli.mjs brief fixtures/negative-malformed.json
node src/cli.mjs brief fixtures/partial-missing-price.json
node src/cli.mjs brief fixtures/partial-unavailable-free.json
node src/cli.mjs brief fixtures/external-cost.json
npm test
```

## Expected demo summary shape

```json
{
  "schema": "x402.r2.consumer.procurement_brief.v1",
  "demo": true,
  "note": "Synthetic fixtures only; no live paid calls.",
  "results": {
    "positive.json": {
      "status": "ready",
      "contractCount": 2,
      "priceStates": ["quoted", "quoted"],
      "freeStates": ["not_equivalent", "equivalent"],
      "error": null,
      "hasInvestmentRecommendation": false
    },
    "negative-malformed.json": {
      "status": "rejected",
      "hasInvestmentRecommendation": false
    },
    "partial-missing-price.json": {
      "status": "partial_input",
      "priceStates": ["quoted", "missing_price"]
    },
    "partial-unavailable-free.json": {
      "status": "ready",
      "freeStates": ["unavailable"]
    },
    "external-cost.json": {
      "status": "ready",
      "priceStates": ["external_cost", "stale_or_untrusted_source"]
    }
  }
}
```

## Expected positive brief (truncated)

```json
{
  "schema": "x402.r2.consumer.procurement_brief.v1",
  "status": "ready",
  "taskNeeds": { "musts": ["extract_batch_json", "https_source_url", "bounded_summary"] },
  "comparisons": [
    {
      "contractId": "svc-extract-a",
      "needCoverage": { "coverageStatus": "matched" },
      "priceState": "quoted",
      "freeBaseline": {
        "freeAlternativeState": "not_equivalent",
        "freeAlternativeBasisId": "free_public_docs_checked_v1"
      },
      "evidenceRefs": ["fixture:positive.json#svc-extract-a"]
    }
  ],
  "summary": {
    "needCount": 3,
    "contractCount": 2,
    "note": "Factual counts only. No investment recommendation, ranking, or revenue projection."
  },
  "reuseFrom": "R2-CAPABILITIES-04"
}
```

Rejected inputs exit code `1` for `brief`; demo always exits `0` after reporting.
