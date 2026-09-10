# Fresh-consumer instructions — R2-RECORD-JOBS-06

Literal steps for a new consumer. No live crawl. Synthetic fixtures only.
Calendar covers **only** the supplied notices — not all deadlines on the internet.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/record_jobs/06
```

Requires Node ≥ 20. No `npm install` needed (pure Node ESM, zero dependencies).

## 2. Run the focused test suite

```sh
npm test
# equivalent: node --test tests/*.test.mjs
```

Expect positive / negative / partial / ambiguous-retention cases to pass.

## 3. Run the truthful demo

```sh
npm run demo
# equivalent: node src/cli.mjs demo
```

Demo walks all fixtures and prints status + entry counts. It never emits invest
advice, SEO rank, traffic projection, compliance score, or legal certification.

## 4. Build a calendar from a fixture

```sh
node src/cli.mjs calendar fixtures/positive.json
node src/cli.mjs calendar fixtures/partial-incomplete.json
```

`report` is an alias of `calendar`. Or pipe JSON on stdin:

```sh
cat fixtures/positive.json | node src/cli.mjs calendar -
```

## 5. Validate input only

```sh
node src/cli.mjs validate fixtures/positive.json
```

## 6. Supply your own notices

Provide JSON with:

- `calendarId` (string)
- `notices[]` — each notice:
  - `sourceId` (required string; unique)
  - `sourceRef` / `url` (optional link back to the notice)
  - `title`, `jurisdiction`, `publishedAt` (optional)
  - `text` / `body` (free text containing explicit date mentions), and/or
  - `statedDates[]` — `{ dateRaw, qualification?, qualifier?, label?, date?, ambiguous? }`

Forbidden on any object: `seoRank`, `trafficProjection`, `investmentRecommendation`,
`complianceScore`, `legalCertification`, `guaranteedDeadline`, `inventedDeadline`,
and related fields (see `src/constants.mjs` `FORBIDDEN_FIELDS`).

## What you get

A calendar with `entries[]` (each source-linked; ISO `date` only when unambiguous;
`dateRaw` + `ambiguous:true` retained for vague mentions) and a factual
`summary` of counts. Always includes `scopeNote`. **No** invest / SEO / traffic /
compliance-score / legal-certification marketing fields.
