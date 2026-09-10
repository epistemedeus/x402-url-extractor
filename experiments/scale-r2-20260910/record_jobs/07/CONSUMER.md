# Fresh-consumer instructions — R2-RECORD-JOBS-07

Literal steps for a new consumer. No live npm crawl. Synthetic fixtures only.
Report covers **only** the supplied lockfile inventories — not a security or
legal certification, and not S127 API impact analysis.

## 1. Enter the package

```sh
cd experiments/scale-r2-20260910/record_jobs/07
```

Requires Node ≥ 20. No `npm install` needed (pure Node ESM, zero dependencies).

## 2. Run the focused test suite

```sh
npm test
# equivalent: node --test tests/*.test.mjs
```

Expect positive / negative / partial / unknown-license / S127-separation /
duplicate-detection cases to pass.

## 3. Run the truthful demo

```sh
npm run demo
# equivalent: node src/cli.mjs demo
```

Demo walks all fixtures and prints status + duplicate counts. It never emits
CVE scores, security certification, legal advice, compliance scores, invest
advice, SEO rank, traffic projection, or S127 API impact scores.

## 4. Build an overlap report from a fixture

```sh
node src/cli.mjs report fixtures/positive.json
node src/cli.mjs report fixtures/partial-incomplete.json
```

`overlap` is an alias of `report`. Or pipe JSON on stdin:

```sh
cat fixtures/positive.json | node src/cli.mjs report -
```

## 5. Validate input only

```sh
node src/cli.mjs validate fixtures/positive.json
```

## 6. Supply your own lock inventories

Provide JSON with:

- `reportId` (string)
- `trees[]` — each tree:
  - `id` (required string; unique)
  - `label`, `lockfileFormat` (optional)
  - `dependencies[]` — `{ name, version, license?, dev? }`, and/or
  - `packages{}` — npm package-lock style map (`node_modules/foo` → `{version,license?,dev?}`)

Single-tree shorthand: top-level `dependencies` / `packages` without `trees[]`
is accepted.

Forbidden on any object: `cveScore`, `securityCertification`, `legalAdvice`,
`complianceScore`, `investAdvice`, `seoRank`, `trafficProjection`,
`s127ApiImpact`, and related fields (see `src/constants.mjs` `FORBIDDEN_FIELDS`).

## What you get

A report with `duplicateRuntimeDependencies[]` (multi-version and/or multi-tree
runtime packages), `declaredLicenses[]` (as given; missing → `unknown`),
`separateFrom: "S127"`, and a factual `summary`. Always includes `scopeNote`.
**No** CVE / security-cert / legal-advice / compliance-score / invest / SEO /
traffic / S127-impact marketing fields.
