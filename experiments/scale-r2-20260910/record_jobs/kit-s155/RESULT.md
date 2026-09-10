# S155 RESULT — source-record job kit

Date: 2026-09-10 (PT). Owner: Pilot Source and Record Jobs R2 (BOT-S155; Heavy pin override BOT-S156 → S154).

## Exact source / ref

- Repository: `epistemedeus/x402-url-extractor`
- Branch: `codex/r2-record-kit-s155-20260910`
- Worktree: `/workspace/pilot/worktrees/r2-record-kit-s155-20260910`
- Pin (start): `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Scope: `experiments/scale-r2-20260910/record_jobs/kit-s155`
- Heavy pin: `epistemedeus/samedaydesk@65ce1867f1b4339cc708bfb72a7d9a5942785632`
  - Branch: `codex/s154-record-metadata-final-20260910`
  - Path: `experiments/s134-record-jobs`
  - Worktree: `/workspace/pilot/worktrees/samedaydesk-s154-record-65ce1867`
  - Env: `HEAVY_S134_ROOT` (defaults to that worktree path)

## What built

ONE thin orchestrator kit with a single journey
(`clean-install` → `example` → `change-output` → `partial` → `refusal`) over:

| Slot | Job | Source |
|---|---|---|
| 01 | openapi-impact | Heavy S154 CLI spawn |
| 02 | pricing-table-change | Heavy S154 CLI spawn |
| 03 | csv-drift | Heavy S154 CLI + wrapper option passthrough (**included**) |
| 04 | rss-atom-brief | Heavy S154 CLI spawn |
| 05 | route-regression | Native absolute worktree import |
| 06 | deadline-calendar | Native absolute worktree import |
| 07 | dependency-footprint | Native absolute worktree import |
| 08 | source-record-kit | Meta packaging layer (this kit) |

CSV is **included** (S154 finished — not held). S154 deltas preserved via
kit wrappers only (null-prototype cells; meta separate; `__status` /
`__extraFields` / `__proto__`; empty vs missing; `columns:false`;
`relax:false`). Heavy tree not amended. Parsers not reimplemented.

## How to run

```sh
cd experiments/scale-r2-20260910/record_jobs/kit-s155
npm test
npm run journey
node src/cli.mjs manifest
node src/cli.mjs run fixtures/positive-journey.json
```

## Tests (this VM)

- Command: `node --test tests/*.test.mjs` (also `npm test`)
- Result: **22 pass / 0 fail**
  - kit: manifest, clean-install, path resolution, positive (Heavy+native+CSV),
    partial missing-native, partial missing-heavy, refusal forbidden/unknown/malformed,
    CSV included + S154 probe + columns/relax wrapper, full journey
  - cli: manifest / journey / run / validate / demo
  - constants: schemas, pins, forbidden fields

## Journey demo summary

- `cleanInstallOk: true`
- `exampleStatus: ready` — openapi, pricing, csv, rss, route ready; kit meta
- `partialStatus: partial` — missing native sibling → `unavailable_native`
- `refusalStatus: rejected` — forbidden `investmentRecommendation`
- `csvProbeAllPass: true`
- `manifestReadyCount: 7`
- `hasInvestmentRecommendation: false`
- change-output written under `demo-out/` (gitignored except `.gitkeep`)

## Heavy issues for Lead

- None blocking against pin `65ce1867`.
- Observation (wrapper-only note): Heavy `compareCsvDrift` still calls
  `parseCsvFile` with default `columns:true, relax:true` only. Non-default
  modes are exercised via the kit wrapper’s direct
  `parseCsvFile(..., { columns, relax })` import passthrough (Heavy tree not
  amended). If Root wants first-class CLI flags `--columns` / `--relax` on
  `s134-csv-drift`, that would be a Heavy follow-up — not done here.

## Limits

- Offline fixtures only; no live paid calls
- Feature-branch push ≠ Root publication
- Requires Heavy worktree + native 05..07 worktrees (or reports unavailable_*)

## Commit / push

- Pin base: `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Feature commit / tip / push: filled after git commit + push below
