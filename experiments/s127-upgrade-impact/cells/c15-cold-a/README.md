# c15 cold consumer A

Native cold consumer: run the pack CLI on real-source case A
(`path-to-regexp` 6.3.0 → 8.4.2) without importing cell internals.

```bash
node cells/c15-cold-a/run.mjs
```

Expects `summary.nextAction === "action"` with used removals/signature
changes (`pathToRegexp`, `tokensToFunction`). Offline. No payment.
