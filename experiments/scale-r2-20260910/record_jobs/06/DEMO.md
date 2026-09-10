# DEMO — R2-RECORD-JOBS-06

Truthful demo commands and expected shapes. Synthetic fixtures only.
Calendar covers only supplied notices; ambiguous dates retained.

## Commands

```sh
cd experiments/scale-r2-20260910/record_jobs/06
node src/cli.mjs demo
node src/cli.mjs calendar fixtures/positive.json
node src/cli.mjs calendar fixtures/negative-malformed.json
node src/cli.mjs calendar fixtures/partial-incomplete.json
npm test
```

## Expected demo summary shape

```json
{
  "schema": "x402.r2.record.deadline_calendar.v1",
  "demo": true,
  "note": "Synthetic fixtures only; no live crawl; calendar covers only supplied notices; ambiguous dates retained.",
  "results": {
    "positive.json": {
      "status": "ready",
      "explicitCount": ">=2",
      "ambiguousCount": ">=2",
      "ambiguousRetained": true,
      "hasSeoRank": false,
      "hasTrafficProjection": false,
      "hasInvestmentRecommendation": false,
      "hasComplianceScore": false,
      "hasLegalCertification": false,
      "scopeNotePresent": true
    },
    "partial-incomplete.json": {
      "status": "partial_input"
    },
    "negative-malformed.json": {
      "status": "rejected"
    }
  }
}
```

## Expected positive calendar (truncated)

```json
{
  "schema": "x402.r2.record.deadline_calendar.v1",
  "status": "ready",
  "entries": [
    {
      "sourceId": "notice-rfp-2026",
      "date": "2026-03-15",
      "dateRaw": "March 15, 2026",
      "ambiguous": false,
      "qualification": "no later than"
    },
    {
      "sourceId": "notice-rfp-2026",
      "date": null,
      "dateRaw": "Q2 2026",
      "ambiguous": true,
      "qualification": "estimated"
    },
    {
      "sourceId": "notice-rfp-2026",
      "date": null,
      "dateRaw": "mid-April 2026",
      "ambiguous": true
    }
  ],
  "scopeNote": "Calendar covers only the supplied public notices. This is not a claim about all deadlines on the internet, nor legal advice or certification."
}
```

Rejected inputs exit code `1` for `calendar`/`report`; demo always exits `0` after reporting.
