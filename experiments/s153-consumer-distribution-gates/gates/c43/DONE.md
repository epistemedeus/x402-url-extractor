# c43 DONE

Gate S3 (conflict-identity) for `freshness-receipt` on pin `fa6878de125cfdcfd77f4b47037c88667090d293`.
Proven: `buildFreshnessReceipt` on `conflict-retrieved-before-source` emits `decision=conflict` (`source_update_after_download`, lagAtDownloadMs=-3460337696) and keeps both `captured_at` and `published_at`; horizon `disposition=current` does not upgrade to pass.
Proven: `conflict-two-source-updates` keeps both `published_at` values in `issues.params.values`; `sourceUpdatedAt` stays null (no max/first winner). Same `npm:vercel` id concatenates times and still conflicts.
CLI `analyze freshness-receipt --in …/cases/conflict-*.json` exits 0 with `decision=conflict` and conflict-polarity findings. `validateReceipt` ok. Claims/payment stay false. Jobs 07/08 unwired.
Reused S137 fixtures + `src/freshness-receipt/{schema,transform}.mjs` + `scripts/cli.mjs`. Did not recreate S137 cells.
Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, `DONE.md`.
Test: `node --test experiments/s153-consumer-distribution-gates/gates/c43/gate.test.mjs` → 6 pass.
