# c27 changelog-only baseline (kill side A)

Schema: `s127.upgrade-impact.changelog-stub.v1`  
Baseline id: `A`  
Module: `cells/c27-changelog-stub/changelog.mjs`  
Evidence in this cell: **synthetic** and **fixture** (sibling-derived excerpts). **No live-capture.**

Kill harness loads this decisioner as the "read registry + changelog" side. Usage binding (c06 / `src/bind.mjs`) is side B.

## Input (only these fields are read)

| Field | Role |
| --- | --- |
| `oldVersion` / `dependency.oldVersion` | required for a claim |
| `newVersion` / `dependency.newVersion` | required for a claim |
| `changelogText` or `changelog` | optional text, `{ text\|body }`, or `{ releases: [{ tag_name, body }] }` |
| `clock` | passed through; never invented |
| `evidenceClass` / `label` | `fixture` \| `live-capture` \| `synthetic` |

`usage`, `exportDiff`, `bindings`, `lockfile`, `imports`, `sourceRoots`, and `caller` are **ignored**. If they are present, `ignoredCallerSurfaces: true`.

No filesystem read. No network. A `changelog.url` or `changelog.path` without text is **missing** coverage, not a fetch.

## Output

```
{
  schema, baseline: "A", usageBinding: false,
  decision: "action" | "no_action" | "unknown",
  ruleId, rationale, delta,
  versions, changelog: { present, coverage, signals, contentSha256, label, ... },
  summary: { nextAction: <decision>, unknownReasons[], unusedChanges: [], actionableChanges: [] },
  bindings: [],
  ignoredCallerSurfaces, evidenceClass, clock, createdAt,
  limitations[], provenance[], execute: false, paidDemand: false
}
```

`summary.unusedChanges` and `summary.actionableChanges` are always empty: this stub cannot name used symbols. `bindings` is always `[]`.

Packet-coarse `summary.nextAction` equals `decision` so it can be compared to a binder after mapping `review_breakages` / `upgrade_with_edits` → `action` (`compare.mjs`).

## Decision table (first match)

1. Hostile / non-object input → `unknown` (`hostile_or_invalid_input`)
2. Missing old or new version → `unknown` (`missing_version`)
3. Same version (string-equal or `v` prefix only) → `no_action` (`same_version_noop`) even if notes say BREAKING
4. Same core, different prerelease/build → `unknown` (`prerelease_identity_unknown`)
5. Unparseable versions + breaking keywords → `action` (`changelog_breaking_keyword`)
6. Unparseable versions otherwise → `unknown` (`unparseable_version`)
7. Changelog keywords breaking / removed / renamed / ESM-only / incompatible → `action` (`changelog_breaking_keyword`)
8. No changelog text + major/minor → `action` (`registry_bump_no_changelog`)
9. No changelog text + patch (or unknown delta) → `unknown` (`patch_without_changelog`)
10. Patch + only fix/docs/perf/added keywords → `no_action` (`changelog_nonbreaking_patch`)
11. Major/minor with non-breaking or unclassified notes → `action` (`semver_minor_or_major_requires_review`)
12. Patch with unclassified prose → `unknown` (`changelog_unclassified_patch`)

## Weaker than usage binder by design

Packet-contract rules 1–2 are **not** applied here:

- A newer minor/major with no notes is `action` (naive "a newer version exists" / S122 `review_changelog`).
- Breaking changelog keywords are `action` even when the named export is unused by the caller.
- The stub never emits per-symbol `used` bindings, so it cannot split unused vs used on the same bump.

The binder is stronger when it:

- says `no_action` for unused removals / added-only bumps the stub called `action`
- says `action` for a used removal on a patch the stub left `unknown`
- says `unknown` on dynamic import / partial source instead of a keyword guess

`compareBaselineToBinder(stub, bindResult)` is the kill-harness primitive. If real cases A/B never flip the coarse decision, record negative evidence and stop packaging as a paid job.

## Labels

- **synthetic** — hand-written notes and versions in `fixtures/synthetic/`
- **fixture** — excerpts copied from sibling c11/c12 captures in `fixtures/from-sibling/` (not re-fetched)
- **live-capture** — not produced by this cell

## Exercise (offline)

```bash
node --test cells/c27-changelog-stub/test/changelog.test.mjs
node cells/c27-changelog-stub/run-fixtures.mjs
```

No `npm install`. Node 20+.
