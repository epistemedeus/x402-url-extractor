# R2-RECORD-JOBS-06 — Deadline evidence calendar

Isolated experiment under `experiments/scale-r2-20260910/record_jobs/06` in
`epistemedeus/x402-url-extractor`.

## Outcome

Extract **explicit** dates and qualifications from **caller-supplied** public
notices into a source-linked calendar. Ambiguous dates are **retained**
(`dateRaw` + `ambiguous:true`); never invent a precise ISO when the source is
vague.

## Constraints

- Caller-supplied notice fixtures only — **never** crawl live sites; never invent
  deadlines absent from notice text
- Explicit `scopeNote`: calendar covers **only** the supplied notices — not all
  deadlines on the internet; not legal advice or certification
- No invest advice, SEO rank, traffic projection, "compliance score", or legal
  certification marketing claims
- Synthetic / public fixtures only
- Feature-branch source/tests only — Root owns merge, publication, and paid actions

## Calendar entry fields

| Field | Meaning |
| --- | --- |
| `sourceId` / `sourceRef` | Link back to the supplied notice |
| `date` | ISO `YYYY-MM-DD` when unambiguous; otherwise `null` |
| `dateRaw` | Original text span retained always |
| `ambiguous` | `true` when ISO cannot be honestly derived |
| `qualification` | Nearby qualifier if present (`no later than`, `estimated`, `subject to`, …) |
| `jurisdiction` | Copied from notice when supplied |
| `confidence` | `high` · `qualified` · `ambiguous` · `none` |

## Schema

- Input: `x402.r2.record.deadline_calendar_input.v1`
- Calendar: `x402.r2.record.deadline_calendar.v1`
- Status: `ready` | `partial_input` | `rejected`

## Quick start

See `CONSUMER.md` and `DEMO.md`.

```sh
cd experiments/scale-r2-20260910/record_jobs/06
npm test
npm run demo
node src/cli.mjs calendar fixtures/positive.json
```

## Mutation boundary

Exact feature-branch source only. Do not merge/publish/pay from this package.
