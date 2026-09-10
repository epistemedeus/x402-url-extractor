# R2-RECORD-JOBS-05 RESULT — Public route regression report

Date: 2026-09-10 (PT). Owner: Pilot Source and Record Jobs R2 (packages 05..08).

## Exact source / ref

- Repository: `epistemedeus/x402-url-extractor`
- Branch: `codex/r2-record-jobs-05-20260910`
- Pin (start): `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Scope: `experiments/scale-r2-20260910/record_jobs/05`

## What built

Caller-supplied baseline+current route snapshot comparator with deltas:
`unchanged|removed|redirected|inaccessible|restored|status_changed|added`.
Bounded `scopeNote` (not entire internet). Forbidden SEO/traffic/invest/health fields.
CLI: `report` | `validate` | `demo`. Fixtures: positive / partial / negative.

## How to run

```sh
cd experiments/scale-r2-20260910/record_jobs/05
npm test
npm run demo
node src/cli.mjs report fixtures/positive.json
```

## Tests (this VM)

- Command: `node --test tests/*.test.mjs` (also `npm test`)
- Result: **14 pass / 0 fail** (compare positive/negative/partial/status_changed/scopeNote; validate; cli)
- Demo: `node src/cli.mjs demo` → positive ready (removed/redirected/inaccessible/restored/added), partial_input, rejected forbidden

## Acceptance

- [x] Worktree + branch at pin base
- [x] Runnable bounded artifact under experiment path only
- [x] Focused tests: positive / negative / partial (+ forbidden claims)
- [x] Literal fresh-consumer instructions (`CONSUMER.md` / `README.md`)
- [x] Truthful demo on fixtures
- [x] Exact feature-branch source + this compact RESULT
- [x] No SEO rank / traffic projection / invest advice / site health score claims

## Limits

- Snapshot-pair compare only; no live crawl; no invented routes
- Report is not a claim about the entire internet
- Root owns merge / publication / paid actions
- Packages 01..04 owned by Heavy — not touched

## Commit

See git log on `codex/r2-record-jobs-05-20260910` after commit (SHA filled in commit message / Lead summary).
