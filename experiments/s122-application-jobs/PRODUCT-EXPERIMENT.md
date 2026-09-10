# Product / experiment decisions (Stage-1)

Internal / owner-QA. Not organic demand. Each job is one page.

---

## Job A — npm CLI release follow-up (`vercel`)

**Hypothesis.** An operator who pins `vercel` and keeps agent tool notes will
act on a one-shot recipe that maps two official npm observations plus an
immutable prior into one next action, instead of curling the registry and
guessing.

**Offer.** Given pin `59.9.1` (published `2026-08-27T19:00:26.541Z`) and current
`59.15.1` (published `2026-09-10T01:12:17.696Z`), emit
`review_changelog | bump_pin | refresh_agent_tool_notes | no_action` with a
rule id. Unchanged / partial / stale current / identity mismatch stay visible.

**Why an agent chooses this over raw `GET https://registry.npmjs.org/vercel`.**
Raw fetch returns a document. It does not keep prior integrity, classify
`59.9.1 → 59.15.1` as **minor** (not patch), refuse a next-action when
`published_at` is missing, or capture a continuation packet for a second
snapshot. SameDayDesk `source-change-alert` can diff `version` but will not
say "review changelog before bumping the pin".

**Policy (first match).** Minor/major → `review_changelog`. Patch +
`ignorePatch` → `no_action`. Patch + notes-first policy →
`refresh_agent_tool_notes`. Pin lag → `bump_pin`. Unchanged + notes current →
`no_action`. Partial/stale/error → `nextAction` is null.

**Checkable change.** Fixture from live registry, capture `2026-09-10T09:54:59Z`.
Label: `fixture` (run) / captured-from-live (snapshot).

**Distribution seam.** This pack's CLI; SameDayDesk outcome words; optional
task-kit `continue`.

**Cost.** $0 this assignment. Future paid freshness: extract 0.005 / batch 0.01
USDC listed, not invoked.

**Next experiment (measurable).** After a human changelog review, re-run with
`fixtures/npm-vercel/prior.seq-2-after-review.json` and
`operator-notes-refreshed.json`. Expect `unchanged` + `no_action`. Kill if
operators only re-curl the registry and ignore `nextAction`.

**Correction/return.** Second independently sourced snapshot
`second-snapshot-version-doc.json` (npm version document, no `published_at`)
corrects to `partial` and does not overwrite the continuation packet. A
matching second run of `current.json` **returns** `body_unchanged`.

---

## Job B — runtime EOL / support deadline watch (Node.js)

**Hypothesis.** Operators need "days-to-eol vs my horizon" as a next action,
not a page-change of the endoflife.date HTML.

**Offer.** Watch cycles `20/22/24`, injectable clock, `horizonDays` required,
`urgentDays` default 14 (documented constant). Emit
`upgrade_now | schedule_upgrade | monitor | no_action`.

**Why this over raw `GET https://endoflife.date/api/nodejs.json`.** The 2026-03-01
and 2026-09-10 slim extracts have **identical cycle rows**. A field diff is
`unchanged`. The recipe still reports `changed` + `upgrade_now` because Node 20
(`eol: 2026-04-30`) crossed EOL between clocks (60 days out → already past).
`source-change-alert` cannot see that.

**Labeled clocks.** Prior `2026-03-01T00:00:00Z` → `schedule_upgrade` (60 days
to Node 20 EOL, horizon 90). Current `2026-09-10T09:54:59Z` → `upgrade_now`.
Node 24-only: support `2026-10-20` is 40 days out → `schedule_upgrade`.

**Checkable change.** Live API rows in `eol-nodejs-*-slim.json` and full
`eol-nodejs.json`. Label: `fixture`.

**Distribution seam.** Same as Job A.

**Cost.** $0. Same future listed prices, not invoked.

**Next experiment.** Re-run with `pinnedRuntime: "22"` and watch `["22","24"]`
after the operator leaves Node 20. Expect `schedule_upgrade` or `no_action`,
never a silent `upgrade_now` for an already-migrated pin. Kill if the only
users are our own agents.

**Correction/return.** Full API array as second snapshot still `upgrade_now`;
continuation compare **returns**. Partial missing `eol` on cycle 20 does not
claim `upgrade_now`.

---

## Job C — agent CLI release follow-up (`@anthropic-ai/claude-code`)

**Hypothesis.** Agents hallucinate stale CLI flags. A patch on
`@anthropic-ai/claude-code` should refresh runbook notes before (or with) a pin
bump, unless the operator explicitly ignores patches.

**Offer.** Prior `2.1.260` (`2026-09-03T22:32:02.087Z`) → current `2.1.267`
(`2026-09-09T18:25:42.820Z`). Default policy `preferNotesRefreshOnPatch=true`
→ `refresh_agent_tool_notes` with follow-up `bump_pin`. Operator
`ignorePatch=true` → `no_action` on the **same** evidence.

**Why this over raw npm GET.** Same integrity and policy reasons as Job A, with
a different default: patches matter for flag-sensitive agent CLIs. Job A treats
the vercel **minor** as changelog-first; Job C treats the claude **patch** as
notes-first. That is the application layer, not another HTML watcher.

**Checkable change.** Fixture from live registry. Label: `fixture`.

**Distribution seam.** Same npm adapter as Job A (`runNpmReleaseRecipe`) with
agent-CLI defaults; task-kit continue for second snapshot.

**Cost.** $0. Same future listed prices, not invoked.

**Next experiment.** After notes refresh, re-run with
`lastReviewedVersion: "2.1.267"` and pin still `2.1.260`. Expect `bump_pin`.
Then bump the pin and expect `no_action`. Kill if ignore-patch is the only
observed behavior (recipe adds no value over "stay on 2.1.260").

**Correction/return.** CLI `continue correction` against the same current slim
returns `body_unchanged`. Version-document second snapshot (no `published_at`)
updates to `partial` without mutating the packet.
