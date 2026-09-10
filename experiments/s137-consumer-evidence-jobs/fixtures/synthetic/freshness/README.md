# Synthetic freshness evidence (S137 c28)

Label: **`synthetic`**. Job: `R2-CONSUMER-JOBS-06` dataset freshness receipt.

Clock: `2026-09-10T09:54:59Z` from S122 `CAPTURED_AT_UTC.txt` (same bytes as `CLOCK.txt`).

These files are `s137.freshness-receipt.input.v1` cases (`datasets[].times[]` + `locator` + `citations[].contentSha256`) for a later freshness-receipt transform. They are not live-capture, not paid demand, and not a real-dataset PROVENANCE pack (that is cell c29).

## Time fields (do not collapse)

| Field | Meaning | Must not be filled from |
| --- | --- | --- |
| `retrievedAt` | download / capture time | `sourceUpdatedAt`, operator `clock` |
| `sourceUpdatedAt` | source last-modified / `published_at` | `retrievedAt`, `as_of_clock`, operator `clock` |
| `clock` | operator-supplied comparison instant | dataset payload |

A later transform must emit both ages when both times exist, and must not copy one into the other.

## Cases

| Id | Kind | `expect.decision` | Why |
| --- | --- | --- | --- |
| `positive-complete` | positive | `pass` | vercel + claude-code slims; both times present and distinct; coverage complete |
| `negative-missing-times` | negative | `unknown` | version document body has neither time; clock is not substituted |
| `negative-future-source-update` | negative | `unknown` | `sourceUpdatedAt` `2099-01-01T00:00:00Z` from `discovery-drift.test.mjs` |
| `partial-missing-source-update` | partial | `partial` | retrieval age yes, source update no; EOL watch 3/26 cycles |
| `conflict-retrieved-before-source` | conflict | `conflict` | S122 `stale-current` capture before `published_at` |
| `conflict-two-source-updates` | conflict | `conflict` | two `npm:vercel` bodies, same `retrievedAt`, different `sourceUpdatedAt` |

## Layout

- `CLOCK.txt` — operator clock pin
- `sources/*.json` — slim field-preserving extracts from S122 fixtures
- `cases/*.json` — input packets with `citations[]` and expected findings
- `catalog.mjs` — loader + sha256 + provenance writer
- `PROVENANCE.json` — sha256 per file; `liveCapture: false`

## Test

```
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/freshness/freshness.fixtures.test.mjs
```
