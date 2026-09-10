# Synthetic release-brief fixtures

Label: **`synthetic`**. Authored announced / shipped / tested lane documents
for R2-CONSUMER-JOBS-02. Not live-capture. Not paid demand.
Clock: `2026-09-10T12:00:00.000Z` (`CLOCK.txt`).

Job outcome (from owned portfolio): produce an auditable release brief from
supplied commit/release inputs, **keeping announced, shipped and tested facts
separate**. These fixtures pin the four required case kinds. They do not run
the transform (c07) and do not define the schema module (c06).

Subject package `demo-release-kit` is unpublished lab identity. Commit SHAs
are `sha1` of a lab string, not objects from this repository.

## Lanes (do not merge)

| Lane | Source shape | Identity fields |
| --- | --- | --- |
| `announced` | GitHub-release-shaped JSON | `tag_name`, `draft`, `prerelease`, `published_at`, `target_commitish`, `body` |
| `shipped` | git tag / commit JSON | `tag_name`, `object.sha`, `tagged_at` |
| `tested` | CI check-run-shaped JSON | `head_sha`, `status`, `conclusion`, `completed_at` |

An announced `body` that mentions tests is still an **announced claim**.
The tested lane is the only place `conclusion` is a tested fact.

## Required cases

| Id | Kind | Expected `decision` | Why |
| --- | --- | --- | --- |
| `positive-aligned` | positive | `pass` | Same `tag_name` v1.2.0 and SHA across all three lanes; published, not draft; CI `success`. |
| `negative-empty` | negative | `unknown` | No announced, shipped, or tested documents. |
| `negative-draft-only` | negative | `fail` | Announced `draft: true` and `published_at: null`; no shipped/tested (`draft_not_shipped`). |
| `partial-missing-tested` | partial | `partial` | Announced and shipped agree; tested lane absent. |
| `partial-announced-only` | partial | `partial` | Published announcement only. |
| `partial-shipped-no-announce` | partial | `partial` | Git tag and CI present; no announcement. |
| `conflict-tag-mismatch` | conflict | `conflict` | Announced `v1.2.0` vs shipped `v1.1.9`. |
| `conflict-sha-mismatch` | conflict | `conflict` | Same tag; announced `target_commitish` ≠ shipped `object.sha`. |
| `conflict-ci-vs-announce` | conflict | `conflict` | Announced body "All tests passed" vs tested `conclusion: failure`. |

## Source-informed, not invented

See `SOURCE-PINS.json`. Shapes reuse GitHub release / check-run field names
and this pack's packet decision vocabulary. Fixtures do not claim a GitHub
release or git tag exists for this repository.

## Layout

- `cases/<id>.json` — case descriptor, expected decision, cited findings
- `sources/<id>/` — per-lane JSON (or `NOTICE.json` when all lanes absent)
- `SOURCE-PINS.json` — repo path + excerpt that must still appear in that file
- `PROVENANCE.json` — sha256 of authored artifacts
- `catalog.test.mjs` — node:test catalog integrity (not the c10 transform suite)

## Exercise

From repository root:

```bash
node --test experiments/s137-consumer-evidence-jobs/fixtures/synthetic/release-brief/catalog.test.mjs
```
