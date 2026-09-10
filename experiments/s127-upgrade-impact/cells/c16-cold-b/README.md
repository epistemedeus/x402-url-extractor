# c16 cold consumer B

Native cold consumer: run the pack CLI on real-source case B
(`cookie` 1.1.1 → 2.0.1) with a primary caller that uses `parse` only.

```bash
node cells/c16-cold-b/run.mjs
```

Expects `summary.nextAction === "action"` for used `parse` removal, and
unused `serialize` as not a caller defect. Offline. No payment.
