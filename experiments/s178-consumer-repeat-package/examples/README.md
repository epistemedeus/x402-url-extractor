# First-use examples

These are the catalog recipes under each job's fixture root. Default `run <job>` uses the positive recipe.

| Job | Positive | Partial | Negative |
| --- | --- | --- | --- |
| 01 migration-checklist | `cases/positive-complete.json` | `cases/partial-batch-undocumented.json` | `cases/negative-malformed-inventory.json` |
| 02 release-brief | `cases/positive-aligned.json` | `cases/partial-announced-only.json` | `cases/negative-draft-only.json` |
| 03 table-reconcile | `cases/positive-agree.json` | `cases/partial-row-coverage.json` | `cases/negative-empty.json` |
| 04 link-index | `cases/positive-md/` | `cases/partial-mixed/` | `cases/negative-empty/` |
| 05 replay-pack | `cases/positive-unpaid-complete/` | `cases/partial-mixed-operations/` | `cases/negative-paid-marker/` |
| 06 freshness-receipt | `cases/positive-complete.json` | `cases/partial-missing-source-update.json` | `cases/negative-missing-times.json` |
| 07 procurement-brief | `positive.json` | `partial-missing-price.json` | `negative-malformed.json` |
| 08 customer-result-package | `positive-journey.json` | `partial-missing-heavy.json` | `negative-unknown-recipe.json` |
| acquire | `partial-journey.json` (acquisition-ok partial) | same | `rejected-package.json` |

In-repo roots: `experiments/s137-consumer-evidence-jobs/fixtures/synthetic/<job>` and `experiments/scale-r2-20260910/consumer_jobs/{07,08,compose}/fixtures`.

Clean kit unpack: same files under `vendor/`.
