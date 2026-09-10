# R2-CONSUMER-S152 compose

Composes Heavy S137 consumer-evidence jobs (01–06) into native consumer_jobs/08
journey alongside procurement-brief (07).

- Heavy source pin: `resolvedInputCommit=fa6878de125cfdcfd77f4b47037c88667090d293`
- CLI: `experiments/s137-consumer-evidence-jobs/scripts/cli.mjs`
- Packet schema: `s137.consumer-evidence.packet.v1`
- No publication / payment; fixture URLs stay data (not fetched).

```sh
npm test
npm run journey
```
