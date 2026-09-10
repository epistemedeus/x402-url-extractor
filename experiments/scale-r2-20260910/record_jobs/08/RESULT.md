# R2-RECORD-JOBS-08 RESULT — Recurring job bundle

Date: 2026-09-10 (PT). Owner: Pilot Source and Record Jobs R2 (packages 05..08).

## Exact source / ref

- Repository: `epistemedeus/x402-url-extractor`
- Branch: `codex/r2-record-jobs-08-20260910`
- Pin (start): `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Scope: `experiments/scale-r2-20260910/record_jobs/08`

## What built

Recurring job bundle over native-owned record jobs **05..07** (route regression,
deadline calendar, dependency footprint) with embedded public/synthetic fixture
pairs and dynamic sibling imports. Heavy **01..04** are catalog stubs only
(`owned_by_heavy` / `not_bundled_here`) — not copied or rebuilt.

CLI: `bundle` | `run` | `validate` | `demo`. Fixtures: positive / partial /
negative. Sibling BOUNDARY: absolute worktree → relative `../05|06|07` →
embedded fixture + `unavailable_sibling` (no invented outputs).

## How to run

```sh
cd experiments/scale-r2-20260910/record_jobs/08
npm test
npm run demo
node src/cli.mjs bundle
node src/cli.mjs run fixtures/positive-bundle.json
```

## Tests (this VM)

- Command: `node --test tests/*.test.mjs` (also `npm test`)
- Result: **19 pass / 0 fail**
  - bundle: manifest, positive 05+06+07, partial missing-sibling, partial incomplete fixture, negative forbidden/unknown/malformed, validate
  - cli: bundle/demo/run/validate/stdin
  - constants: schemas, native ids, forbidden fields
- Demo: positive ready (absolute_worktree ×3), partial unavailable_sibling + owned_by_heavy, negative forbidden_claim + unknown_job

## Acceptance

- [x] Worktree + branch at pin base
- [x] Runnable bounded artifact under experiment path only
- [x] Focused tests: positive / negative / partial
- [x] Literal fresh-consumer instructions (`CONSUMER.md` / `README.md`)
- [x] Truthful demo on fixtures
- [x] Exact feature-branch source + this compact RESULT
- [x] No inventing Heavy 01..04 / buyers / SEO / traffic / invest / security / legal claims
- [x] Feature-branch push authorized (≠ Root publication)

## Limits

- Bundles 05..07 only; Heavy 01..04 stubs only
- Sibling libraries required for real nested outputs; else `unavailable_sibling`
- Offline fixtures only; Root owns merge / publication / paid actions

## Commit / push

- Pin base: `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Feature commit: _pending local commit_
- Push: _pending_
