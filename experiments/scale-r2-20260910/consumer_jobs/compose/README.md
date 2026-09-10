# R2-CONSUMER-S152 compose + S159 acquisition

Composes Heavy S137 consumer-evidence jobs (01–06) into native consumer_jobs/08
journey alongside procurement-brief (07). S159 adds a buyer **acquisition
status** interface that surfaces exact partial package decisions.

- Heavy source pin: `resolvedInputCommit=fa6878de125cfdcfd77f4b47037c88667090d293`
- CLI (08 journey): `../08/src/cli.mjs`
- CLI (acquisition status): `src/cli.mjs status`
- Packet schema: `s137.consumer-evidence.packet.v1`
- Acquisition schema: `x402.r2.consumer.acquisition_status.v1`
- First-result offer schema: `x402.r2.consumer.first_result_offer.v1` (green 01/02/06/07 only; `packageNote=partial_first_result`)
- Positive integrated journey: package status often **`partial`** (Heavy CLI
  fail on table-reconcile / link-index / replay-pack — external defects)
- No publication / payment / investment claims; fixture URLs stay data

```sh
npm test
npm run test:status
npm run journey
npm run status -- --journey fixtures/partial-journey.json
npm run first-result
npm run test:first-result
```

Docs: `CONSUMER.md`, `ACQUISITION.md`, `FIRST-RESULT.md`, `FROZEN-E2E-PACKET-S152.md`.
