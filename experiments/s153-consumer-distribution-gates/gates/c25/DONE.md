# c25 DONE

S1 positive-workflow on `link-index` (R2-CONSUMER-JOBS-04). Pinned synthetic cases `positive-md` (entry sha256 `5cb5a4f0…071bfad`) and `positive-html` (`3225b086…033b8a1`) match S137 fixtures. `transformLinkIndex` / `transform` emit `decision=pass`, three `reachable` findings each (cited into `citations[]` whose `contentSha256` matches the inventory files), all hrefs reachable, `unreachable[]`/`conflicts[]` empty, `coverage.networkFetched=false`. CLI `analyze link-index` on the same schema input exits 0 with `pass` and those cited rows. Offline, `payment.attempted=false`, no demand claims. Jobs 07/08 unused.

Files: `PIN.json`, `helper.mjs`, `gate.test.mjs`, this `DONE.md`. Reused `src/link-index/{schema,transform}.mjs` and `fixtures/synthetic/link-index` (not recreated).

```
node --test experiments/s153-consumer-distribution-gates/gates/c25/gate.test.mjs
```

Result: **7 pass, 0 fail**.
