# R2-RECORD-JOBS-07 RESULT — Dependency footprint overlap

Date: 2026-09-10 (PT). Owner: Pilot Source and Record Jobs R2 (packages 05..08).

## Exact source / ref

- Repository: `epistemedeus/x402-url-extractor`
- Branch: `codex/r2-record-jobs-07-20260910`
- Pin (start): `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Scope: `experiments/scale-r2-20260910/record_jobs/07`

## What built

Caller-supplied lockfile / dependency inventory comparator. Surfaces
**duplicate runtime dependencies** (multi-version and/or multi-tree) and
**declared licenses** as given (`unknown` when missing — no invented SPDX).
Bounded `scopeNote` + `separateFrom: "S127"`. Forbidden CVE/security-cert/
legal-advice/compliance-score/invest/SEO/traffic fields. CLI: `report`|
`overlap` | `validate` | `demo`. Fixtures: positive / partial / negative.

## How to run

```sh
cd experiments/scale-r2-20260910/record_jobs/07
npm test
npm run demo
node src/cli.mjs report fixtures/positive.json
```

## Tests (this VM)

- Command: `node --test tests/*.test.mjs` (also `npm test`)
- Result: **17 pass / 0 fail** (overlap positive/negative/partial/unknown-license/S127/single-tree-multi-version; validate; cli)
- Demo: `node src/cli.mjs demo` → positive ready (lodash multi-version + express multi-tree; debug unknown license), partial_input, rejected forbidden

## Acceptance

- [x] Worktree + branch at pin base
- [x] Runnable bounded artifact under experiment path only
- [x] Focused tests: positive / negative / partial (+ duplicate detection + unknown license + forbidden + S127 separation)
- [x] Literal fresh-consumer instructions (`CONSUMER.md` / `README.md`)
- [x] Truthful demo on fixtures
- [x] Exact feature-branch source + this compact RESULT
- [x] No CVE score / security certification / legal advice / compliance score / invest / SEO / traffic / S127 impact claims
- [x] Missing licenses retained as `unknown` without inventing SPDX

## Limits

- Supplied lockfile / inventory compare only; no live npm crawl; no invented licenses or CVE scores
- Report is not security or legal certification, nor S127 API impact analysis
- Root owns merge / publication / paid actions
- Packages 01..04 owned by Heavy — not touched; 08 not implemented here

## Commit

- Feature commit: `PENDING`
- Pin base: `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Local only (Root owns publication/push)
