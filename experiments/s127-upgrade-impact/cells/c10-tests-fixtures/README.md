# c10 — synthetic fixtures and core tests

Owned write paths:

- `cells/c10-tests-fixtures/`
- `fixtures/synthetic/`
- `test/`

Expected src API: [EXPECTED-API.md](./EXPECTED-API.md). Stubs that implement that API live in `lib/` so tests can assert now, before integrator modules land in `src/`.

## Exercise

From the pack root `experiments/s127-upgrade-impact`:

```bash
node --test test/*.test.mjs
node --test cells/c10-tests-fixtures/self-test.mjs
node cells/c10-tests-fixtures/scripts/emit-goldens.mjs
```

All fixtures are **synthetic**. Not live-capture. Not paid demand.

## Goldens

`fixtures/synthetic/goldens/removed-export-used.packet.json` is the primary end-to-end packet. Remaining required cases also have goldens for stub-replay.
