# c23 DONE

S7 coverage-integrity for `table-reconcile` (R2-CONSUMER-JOBS-03). Observed sha256 of synthetic/real PROVENANCE pins, case files, and lab tables match PIN claims; synthetic license is authored-synthetic (no SPDX grant); real npm replay is not a license grant or legal attestation. `reconcileTables` decisions match catalog `expectDecision` (`positive-agree`→pass, empty/missing-keys→fail, subset→partial, value/unit/window→conflict) with cited findings and no invented totals. CLI `analyze table-reconcile` on inlined `positive-agree` also yields `pass`; URL `--in` and jobs 07/08 are refused. Packets and fixtures cite no private receipts (no `receipts/`, wallets, or Set-Cookie).

Files: `gates/c23/PIN.json`, `gates/c23/helper.mjs`, `gates/c23/gate.test.mjs`, `gates/c23/DONE.md`. Reused S137 `src/table-reconcile/{schema,transform}.mjs`, `scripts/cli.mjs`, and synthetic/real table-reconcile fixtures. Did not recreate S137 cells.

```
node --test experiments/s153-consumer-distribution-gates/gates/c23/gate.test.mjs
```

Result: **9 pass, 0 fail**. Offline. Expected decision class: `pass`.
