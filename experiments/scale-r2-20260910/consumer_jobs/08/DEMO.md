# DEMO — R2-CONSUMER-JOBS-08 (S152 reality)

Truthful demo commands and expected shapes. Synthetic fixtures only.
Heavy 01–06 are spawned via S137 CLI when recipes are ready — decisions are
recorded as returned. **Do not invent pass.** Positive integrated journey is
usually package status **`partial`**.

## Commands

```sh
cd experiments/scale-r2-20260910/consumer_jobs/08
node src/cli.mjs manifest
node src/cli.mjs demo
node src/cli.mjs journey
node src/cli.mjs assemble fixtures/positive-journey.json
node src/cli.mjs assemble fixtures/partial-conflict-heavy.json
node src/cli.mjs assemble fixtures/negative-unknown-recipe.json
npm test
# acquisition status (compose; partial → exit 0):
node ../compose/src/cli.mjs status --journey demo-out/s152/journey.json
```

## Expected demo summary shape (S152)

```json
{
  "schema": "x402.r2.consumer.customer_result_package.v1",
  "demo": true,
  "note": "Synthetic fixtures only; no live paid calls; Heavy 01–06 spawned via S137 CLI when ready.",
  "results": {
    "manifest.readyCount": 7,
    "manifest.pendingHeavyCount": 0,
    "positive-journey.json": {
      "status": "partial",
      "recipeStatuses": [
        { "id": "migration-checklist", "status": "ready", "decision": "pass" },
        { "id": "release-brief", "status": "ready", "decision": "pass" },
        { "id": "table-reconcile", "status": "failed", "decision": "fail" },
        { "id": "link-index", "status": "failed", "decision": "fail" },
        { "id": "replay-pack", "status": "failed", "decision": "fail" },
        { "id": "freshness-receipt", "status": "ready", "decision": "pass" },
        { "id": "procurement-brief", "status": "ready", "decision": null }
      ],
      "hasInvestmentRecommendation": false
    },
    "partial-conflict-heavy.json": {
      "status": "partial",
      "note": "migration + freshness conflict; procurement-brief ready"
    },
    "negative-unknown-recipe.json": {
      "status": "rejected",
      "recipeStatuses": [{ "id": "not-a-real-recipe-zzz", "status": "unknown" }],
      "hasInvestmentRecommendation": false
    }
  }
}
```

Exact fail slots on the positive path (`table-reconcile`, `link-index`,
`replay-pack`) are **external Heavy CLI defects**, not
`unavailable_pending_heavy`. See `../compose/FROZEN-E2E-PACKET-S152.md`.

## Expected journey summary

`npm run journey` exits 0 and prints paths under `demo-out/` + `demo-out/s152/`,
with `readyRecipes: 7`, `pendingHeavy: 0`, and positive package status typically
`"partial"`. Conflict partial stays `"partial"`; unknown recipe → `"rejected"`.

Rejected assemble requests exit code `1`; demo/journey always exit `0` after
reporting. Compose `status` CLI: **partial → exit 0** (acquisition-ok); rejected
or missing journey → non-zero.
