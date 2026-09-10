# c44 DONE

S4 malformed-input on `freshness-receipt` (R2-CONSUMER-JOBS-06). Reused synthetic negatives `negative-missing-times` and `negative-future-source-update` (hashes match S137 PROVENANCE). `EXAMPLE_CASES.negative` and the missing-times case with clock `now` or a non-ISO `retrievedAt` emit `decision=fail` with cited `now_refused`/`invalid_iso` findings; non-object input throws. Unmutated missing-times stays `unknown` (not invented pass/fail). CLI URL/`--in` missing/oversize exit 1; `--clock now` and jobs 07/08 exit 2; analyzing a `now`-mutated case exits 0 with `fail`. Exits are stable on repeat. Offline, `payment.attempted=false`. Jobs 07/08 unused.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this `DONE.md`. Reused `src/freshness-receipt/{schema,transform}.mjs`, `scripts/cli.mjs`, and `fixtures/synthetic/freshness` (not recreated).

```
node --test experiments/s153-consumer-distribution-gates/gates/c44/gate.test.mjs
```

Result: **4 pass, 0 fail**.
