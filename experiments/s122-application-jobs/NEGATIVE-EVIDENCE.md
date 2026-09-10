# Negative evidence (rejected hypotheses)

Candidates that failed qualification. No sales claim is attached to them.

## crates.io `serde` version dump

- Snapshot: `evidence/snapshots/crates-serde.json` (431 KiB), official
  `https://crates.io/api/v1/crates/serde` shape (`newest_version` 1.0.229,
  `updated_at` 2026-07-18).
- Fail: generic package-version watch duplicates Job A without pin+notes
  decision semantics unique to a buyer CLI. Oversize vs slim recipe I/O.
- Also fails "do not sell extraction when a free official API already solves
  acquisition" if packaged as paid HTML scrape; the API already exists.

## PyPI `httpx` version dump

- Snapshot: `evidence/snapshots/pypi-httpx.json` (118 KiB), official JSON,
  `info.version` 0.28.1, not yanked.
- Fail: same duplicate-of-Job-A pattern. No agent-tool-notes or deadline
  policy that a raw GET lacks.

## GitHub `vercel/vercel` releases

- Snapshot: `evidence/snapshots/github-vercel-releases.json`.
- Observed tags include `vercel@58.4.4` and `@vercel/python@6.54.1` (2026-07-30).
- Fail: monorepo GitHub releases **do not identify** npm `latest` CLI `59.15.1`
  (2026-09-10). Official npm registry already solves acquisition. Using this as
  a paid extract or HTML page-change would duplicate SameDayDesk
  `source-change-alert` without decision semantics and would be the wrong
  source for a CLI pin.

## GitHub `x402` releases

- Snapshot: `evidence/snapshots/github-x402-releases.json` is `[]`.
- Fail: no independently checkable change.

## Generic HTML changelog / `source-change-alert` only

- SameDayDesk already ships `source-change-alert` for named fields on a page.
- Fail for this outcome: no next-action policy, no semver, no clock-crossing
  EOL. Extending with application adapters is the work; forking a parallel
  HTML watcher is not.

## Paid merchant extract of the same JSON

- Free official JSON APIs exist for all three surviving jobs.
- Fail: "selling extraction when a free official API already solves
  acquisition". Documented future list prices (extract 0.005 / batch 0.01 USDC)
  stay **not invoked**.

## Hard avoids (not re-opened)

- S121 Grexal Git-diff packager
- S120 public intake composition
- Existing MoltJobs comparison/dashboard bids
- Generic EIN timing
- S117 requester-delivery packets / competing owner-PR fixes
- Exporting private Pilot context into the public merchant tree
- Fabricated temporal change or fabricated sources (no invented `59.15.2`)
- Logged-in scraping; unattended always-on commitments
