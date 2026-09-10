# Fresh-consumer instructions — S155 source-record job kit

Literal clean-install steps. Offline fixtures only. No live paid calls.
Does **not** reimplement OpenAPI / pricing / CSV / feed parsers.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/record_jobs/kit-s155
```

Requires Node ≥ 20. No `npm install` needed for the kit itself (zero deps).

```sh
# optional habit
npm install
```

## 2. Confirm Heavy S154 root (01..04 including CSV)

```sh
export HEAVY_S134_ROOT=${HEAVY_S134_ROOT:-/workspace/pilot/worktrees/samedaydesk-s154-record-65ce1867/experiments/s134-record-jobs}
ls "$HEAVY_S134_ROOT/package.json"
ls "$HEAVY_S134_ROOT/modules/csv-drift/cli.mjs"
# Heavy deps (already installed on Pilot VM pin checkout):
test -d "$HEAVY_S134_ROOT/node_modules" || (cd "$HEAVY_S134_ROOT" && npm install)
```

Pin: `epistemedeus/samedaydesk@65ce1867f1b4339cc708bfb72a7d9a5942785632`
(`codex/s154-record-metadata-final-20260910`).

If Heavy is missing, kit slots return `unavailable_heavy` — never fake results.

## 3. Confirm native RECORD 05..07

```sh
ls /workspace/pilot/worktrees/r2-record-jobs-05-20260910/experiments/scale-r2-20260910/record_jobs/05/src/index.mjs
ls /workspace/pilot/worktrees/r2-record-jobs-06-20260910/experiments/scale-r2-20260910/record_jobs/06/src/index.mjs
ls /workspace/pilot/worktrees/r2-record-jobs-07-20260910/experiments/scale-r2-20260910/record_jobs/07/src/index.mjs
```

## 4. Run tests

```sh
npm test
# equivalent: node --test tests/*.test.mjs
```

Expect positive / partial / refusal + CSV-included + path-resolution cases to pass.

## 5. Manifest

```sh
node src/cli.mjs manifest
```

Expect `readyCount: 7` (Heavy 01..04 + native 05..07) and `metaCount: 1` (kit/08).

## 6. ONE journey

```sh
npm run journey
# equivalent: node src/cli.mjs journey
```

Writes `demo-out/` artifacts (clean-install, example, partial, refusal, csv probe).

## 7. Run / validate a request

```sh
node src/cli.mjs run fixtures/positive-journey.json
node src/cli.mjs validate fixtures/positive-journey.json
node src/cli.mjs run fixtures/negative-forbidden.json   # exits 1
```

## CSV wrapper note

S154 CSV deltas are preserved via kit wrappers only (no Heavy edits):

- caller headers under null-prototype `cells`
- width/ragged evidence in `meta` only
- `__status` / `__extraFields` / `__proto__` compared as normal columns
- empty vs missing presence preserved
- `columns:false` retains first row as data
- `relax:false` rejects uneven width
