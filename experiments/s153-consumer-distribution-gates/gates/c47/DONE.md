# c47 DONE

S7 coverage-integrity for dataset freshness receipts. Claimed PROVENANCE hashes, license notes, and retrievedAt vs sourceUpdatedAt match observed fixture bytes. Hash drift is `conflict`, not `pass`. Transform and CLI both emit `pass` for `positive-complete` and `nyc-311-erm2-nwe9` with cited findings, `payment.attempted=false`, and no private receipts/logs in packets or kit. Jobs 07/08 stay excluded.

Files: `gates/c47/PIN.json`, `gates/c47/helper.mjs`, `gates/c47/gate.test.mjs`, `gates/c47/DONE.md`. Read-only reuse of `src/freshness-receipt/{schema,transform}.mjs`, `scripts/cli.mjs`, and synthetic/real freshness fixtures.

```
node --test experiments/s153-consumer-distribution-gates/gates/c47/gate.test.mjs
```

9 pass, 0 fail. Offline. Pin `fa6878de125cfdcfd77f4b47037c88667090d293`.
