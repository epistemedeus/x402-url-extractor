# Demo — R2-RECORD-JOBS-08

Truthful offline demo. Synthetic fixtures only. No live crawl. No paid calls.

```sh
cd experiments/scale-r2-20260910/record_jobs/08
node src/cli.mjs demo
```

## Expected summary (this Pilot VM with siblings 05..07 present)

- `manifest.readyCount`: **3**
- `manifest.ownedByHeavyCount`: **4**
- `positive-bundle.json`: status **ready** — three native jobs with real nested
  outputs from dynamic sibling imports (`absolute_worktree` mode)
- `partial-missing-sibling.json`: status **partial** — forced missing siblings →
  `unavailable_sibling` + `owned_by_heavy` stub (outputs null)
- `negative-forbidden.json`: status **rejected** — forbidden invest/SEO/revenue fields
- `negative-unknown-job.json`: status **rejected** — unknown job id

Never claims: buyers/revenue, SEO rank, traffic projection, invest advice,
security certification, legal advice, or that Heavy 01..04 were reimplemented.
