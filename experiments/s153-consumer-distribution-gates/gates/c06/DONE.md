# c06 DONE

S6 import-roundtrip on `migration-checklist` (R2-CONSUMER-JOBS-01). Programmatic import of S137 `schema.mjs` / `transform.mjs` (no CLI). Primary synthetic `positive-complete` hashes match the pin; transform emits `decision=pass`, `coverage=complete`, and cited findings `extract-unchanged`, `read-unchanged`, `batch-added-unused`. JSON roundtrip of packet `OUTPUT_FIELDS` keeps decision, coverage, finding ids, and citations; `validateOutput` accepts the clone. Fail/partial/conflict cases survive the same roundtrip. Real `input.json` roundtrips packet fields without re-claiming `observations.json` decision `partial`. Offline, `payment.attempted=false`, no demand claims. Jobs 07/08 unused.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this `DONE.md`. Reused `src/migration-checklist/{schema,transform}.mjs` and `fixtures/synthetic/migration` (not recreated).

```
node --test experiments/s153-consumer-distribution-gates/gates/c06/gate.test.mjs
```

Result: **9 pass, 0 fail**.
