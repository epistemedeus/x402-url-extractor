# S155 source-record job kit

ONE usable kit assembling **Heavy RECORD 01..04** (S154 pin `65ce1867`) and
**native RECORD 05..08** into a single offline journey.

- Heavy: `openapi-impact`, `pricing-table-change`, `csv-drift`, `rss-atom-brief`
- Native: `route-regression` (05), `deadline-calendar` (06), `dependency-footprint` (07)
- Kit packaging layer stands in for **08** (`source-record-kit` meta)

**CSV is included** (S154 finished). Kit wrappers preserve S154 CSV semantics
without editing the Heavy tree.

## Quick start

```sh
cd experiments/scale-r2-20260910/record_jobs/kit-s155
npm test
node src/cli.mjs journey
```

Requires Node ≥ 20. This kit package has **zero runtime dependencies**.
Heavy modules need their own `node_modules` under `HEAVY_S134_ROOT`.

## Journey

`node src/cli.mjs journey` runs one literal path:

1. **clean-install** — package.json + path checks
2. **example** — openapi + pricing + csv + feed + route positive fixtures
3. **change-output** — structured JSON under `demo-out/`
4. **partial** — missing native sibling / missing fixture → partial
5. **refusal** — forbidden claim / unknown / malformed → rejected

## Heavy root

Default:

`/workspace/pilot/worktrees/samedaydesk-s154-record-65ce1867/experiments/s134-record-jobs`

Override: `HEAVY_S134_ROOT=/path/to/s134-record-jobs`

See `CONSUMER.md`, `DEMO.md`, `PINS.md`, `RESULT.md`.
