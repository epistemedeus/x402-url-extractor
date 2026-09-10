# R2-RECORD-JOBS-06 RESULT — Deadline evidence calendar

Date: 2026-09-10 (PT). Owner: Pilot Source and Record Jobs R2 (packages 05..08).

## Exact source / ref

- Repository: `epistemedeus/x402-url-extractor`
- Branch: `codex/r2-record-jobs-06-20260910`
- Pin (start): `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Scope: `experiments/scale-r2-20260910/record_jobs/06`

## What built

Caller-supplied public-notice deadline extractor into a source-linked calendar.
Explicit ISO dates when unambiguous; ambiguous dates retained (`dateRaw` +
`ambiguous:true`). Qualifications (`no later than`, `estimated`, `subject to`, …)
and jurisdiction preserved. Bounded `scopeNote`. Forbidden invest/SEO/traffic/
compliance-score/legal-certification fields. CLI: `calendar`|`report` | `validate` | `demo`.
Fixtures: positive / partial / negative.

## How to run

```sh
cd experiments/scale-r2-20260910/record_jobs/06
npm test
npm run demo
node src/cli.mjs calendar fixtures/positive.json
```

## Tests (this VM)

- Command: `node --test tests/*.test.mjs` (also `npm test`)
- Result: **16 pass / 0 fail** (calendar positive/negative/partial/ambiguous retention/scopeNote/extract; validate; cli)
- Demo: `node src/cli.mjs demo` → positive ready (explicit+ambiguous retained), partial_input, rejected forbidden

## Acceptance

- [x] Worktree + branch at pin base
- [x] Runnable bounded artifact under experiment path only
- [x] Focused tests: positive / negative / partial (+ ambiguous retention + forbidden claims)
- [x] Literal fresh-consumer instructions (`CONSUMER.md` / `README.md`)
- [x] Truthful demo on fixtures
- [x] Exact feature-branch source + this compact RESULT
- [x] No invest advice / SEO rank / traffic projection / compliance score / legal certification claims
- [x] Ambiguous dates retained without inventing ISO

## Limits

- Supplied-notice extract only; no live crawl; no invented deadlines
- Calendar is not a claim about all deadlines on the internet, nor legal advice
- Root owns merge / publication / paid actions
- Packages 01..04 owned by Heavy — not touched; 07/08 not implemented here

## Commit

- Feature commit: `FEATURE_SHA_PLACEHOLDER`
- Pin base: `1a23b648e3c5f90bc009accb85972e2db6e22051`
- Local only (Root owns publication/push)
