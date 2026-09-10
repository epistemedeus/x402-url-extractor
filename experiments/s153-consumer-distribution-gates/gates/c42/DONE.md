# c42 DONE

S2 partial-prereq on `freshness-receipt` (R2-CONSUMER-JOBS-06). Pinned synthetic case `partial-missing-source-update` hashes match S137 fixtures. Transform emits `decision=partial`, not `pass`: download/retrieval is present, `sourceUpdatedAt` stays null, ages/lag for the missing slot stay null, and `horizonMs` does not invent current/stale. `as_of_clock` / operator clock are not copied into source-update. CLI `analyze freshness-receipt --in cases/partial-missing-source-update.json` exits 0 with the same partial cited findings. Operator-clock-only input is `unknown`, not pass. Offline, `payment.attempted=false`, no demand claims. Jobs 07/08 unused.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this `DONE.md`. Reused `src/freshness-receipt/{schema,transform}.mjs` and `fixtures/synthetic/freshness` (not recreated).

```
node --test experiments/s153-consumer-distribution-gates/gates/c42/gate.test.mjs
```

Result: **6 pass, 0 fail**.
