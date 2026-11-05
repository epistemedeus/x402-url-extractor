# Recheck or reuse a pinned compatibility result

Saved machine entries are compared with the existing page-change tool. The result is `recheck`, `reuse`, or `missing-input`, with the changed fields, the source commit, and freshness. This directory does not fetch, pay, schedule a later observation, or call a hosted tool.

## Captures

`captures/index.json` lists `public/machine/query-key.json` and, where that tree has it, `public/machine/query-key-1.1.0.json`. Each present row records the public path, the git blob id, and the sha256 of the saved bytes. The same bytes are stored once per distinct blob. The 1.1.0 file is absent at `39b05e2f740fc1747f80fa56ffb6f135ebb8afb7`.

A case is refused when a recorded sha256 or blob id does not match the saved bytes. Absence is not an empty document and is not a zero change. Unknown stays unknown.

## Decision

`decide.mjs` checks the capture, projects the pin into a held page observation, and calls `executePageChangeComparison` for every case it can compare. The report must validate with `pageChangeMcpOutputSchema`. There is no second comparison core and no skip path. `reuse` is how an unchanged result is mapped.

Reuse means the compare ran and found the selected projected fields unchanged, and it does not show that a recompute was avoided.

| Case | Decision |
| --- | --- |
| Compare ran and the selected projected fields are unchanged, freshness `unknown` | `reuse` |
| Compare ran and the selected projected fields changed | `recheck`, naming those page field slots |
| Observation order inverted | `recheck`, freshness `inverted` |
| Malformed entry, incomparable report, absent capture, or sha256 mismatch | `missing-input` |

`changedFields` are pin values projected onto page field slots, not entry field names. `title` is the entry schema. `description` is the source commit. `canonical` is the source path. `lang` is the codec. `text` is the archive sha256. `jsonLd` is the corpus sha256. `openGraph` is the corpus schema. `twitter` is the upstream before value. `headings` is the license. `links` is hostedAcquisitionVerified. `aiReadiness` is publicRouteClaimed.

The public comparison does not take a caller clock, so it cannot label a horizon as stale. Inverted observation order is the staleness it can report. Freshness `unknown` is not a current claim and is not zero age. A first-party saved capture is not use. `use` stays null.

`node experiments/n4-recheck-or-reuse/decide.mjs --write` writes `score.json` and `produced-decision.json` from `evaluate()`.

## Git history

Same-path pairs are scored against blob identity. A content `recheck` on equal blobs is a false alert. A `reuse` on different blobs is a missed change. A pair with an absent file has `contentDiff` `unknown`, and `falseAlert` and `missedChange` are null. Those nulls are not zero. `score.json` is that table.

Every comparable same-path pair in these captures has identical blobs. There is no same-path change in history, so the missed-change result is `untested`, not 0 missed. On a comparable pair whose blobs match, the row's `missedChange` is false because that pair did not change. The score does not turn that into a measured miss count.

The saved query-key bytes are the same at all three commits, and the 1.1.0 bytes are the same at the two commits that have the file. Those pairs map to `reuse` after the compare. The changed case compares the two sibling entries at `04be653a1fe009b9bac99fa60c6ab359d4e5c6db`. Their bytes differ, so the decision is `recheck`. That pair is not a same-path replacement. The stale case is the same query-key bytes with inverted observation times, so freshness is `inverted` and the content diff stays empty.

## Produced decision

`produced-decision.json` is the `source-change-alert` result a decide-or-reuse binding reads (`recipeId` `source-change-alert`, `schema` `samedaydesk.recurring-job-recipe-result.v1`). It records the unchanged query-key pin after the compare ran. Its `reuse` decision does not show that a recompute was avoided. This experiment does not run that binding.

Two later consumers can read the same decision: a request-binding replay set, and an accepted-work caller.

The file does not establish live bytes beyond these captures or a later accepted task. Charged amount is unknown.
