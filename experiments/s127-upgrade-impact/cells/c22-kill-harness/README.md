# c22 — Stage-1 kill-condition harness

Offline compare of (A) registry version + changelog skim vs (B) usage-binding packet.

```bash
cd experiments/s127-upgrade-impact/cells/c22-kill-harness
node --test test/*.test.mjs
node harness.mjs compare fixtures/cases/synthetic-standin-a/registry-skim-decision.json fixtures/cases/synthetic-standin-a/binding-packet.json
node harness.mjs suite fixtures/suites/synthetic-keep.json
node harness.mjs suite fixtures/suites/real-ab.json
node harness.mjs isolation
```

Emits `keep | kill | unknown` with rationale. See `KILL-CONDITION.md` and `STAGE1-EXPERIMENT.md`.

All fixtures here are **synthetic**. Real A/B drop-ins: `fixtures/drop-in/real-a|b/`. No payment.
