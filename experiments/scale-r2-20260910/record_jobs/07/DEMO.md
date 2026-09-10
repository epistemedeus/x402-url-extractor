# DEMO — R2-RECORD-JOBS-07

Truthful demo commands and expected shapes. Synthetic fixtures only.
Supplied lockfiles only; not security/legal certification; separateFrom S127.

## Commands

```sh
cd experiments/scale-r2-20260910/record_jobs/07
node src/cli.mjs demo
node src/cli.mjs report fixtures/positive.json
node src/cli.mjs overlap fixtures/positive.json
node src/cli.mjs report fixtures/negative-malformed.json
node src/cli.mjs report fixtures/partial-incomplete.json
npm test
```

## Expected demo summary shape

```json
{
  "schema": "x402.r2.record.dependency_footprint_overlap.v1",
  "demo": true,
  "note": "Synthetic fixtures only; supplied lockfiles only; not security/legal certification; separateFrom S127.",
  "results": {
    "positive.json": {
      "status": "ready",
      "duplicateRuntimeCount": ">=2",
      "unknownLicenseCount": ">=1",
      "separateFrom": "S127",
      "hasCveScore": false,
      "hasSecurityCertification": false,
      "hasLegalAdvice": false,
      "hasComplianceScore": false,
      "hasInvestAdvice": false,
      "hasSeoRank": false,
      "hasTrafficProjection": false,
      "hasS127ApiImpact": false,
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

## Expected positive report (truncated)

```json
{
  "schema": "x402.r2.record.dependency_footprint_overlap.v1",
  "status": "ready",
  "separateFrom": "S127",
  "duplicateRuntimeDependencies": [
    {
      "name": "express",
      "versions": ["4.18.2"],
      "treeIds": ["service-a", "service-b"],
      "reasons": ["multiple_trees"]
    },
    {
      "name": "lodash",
      "versions": ["4.17.20", "4.17.21"],
      "treeIds": ["service-a", "service-b"],
      "reasons": ["multiple_versions", "multiple_trees"]
    }
  ],
  "declaredLicenses": [
    {
      "name": "debug",
      "version": "4.3.4",
      "license": "unknown",
      "licenseUnknown": true
    }
  ],
  "scopeNote": "Report covers only the supplied lockfile / dependency inventory fixtures. This is not a live audit of the internet, not security or legal certification, and not S127 API impact analysis."
}
```

Rejected inputs exit code `1` for `report`/`overlap`; demo always exits `0` after reporting.
