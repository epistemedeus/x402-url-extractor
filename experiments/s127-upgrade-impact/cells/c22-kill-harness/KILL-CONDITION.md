# Measurable kill condition (Stage 1)

Contract text (`docs/PACKET-CONTRACT.md`):

> If binding never changes the decision relative to "read registry + changelog"
> on real cases A/B, record negative evidence and stop packaging as paid job.

This cell makes that checkable without payment.

## Methods

| Id | Name | Input | Output |
| --- | --- | --- | --- |
| A | Registry version + changelog skim stub | `oldVersion`, `newVersion`, optional changelog text + coverage | `summary.nextAction` |
| B | Usage-binding packet | `s127.upgrade-impact.packet.v1` (`usage` + `exportDiff` + `bindings`) | `summary.nextAction` |

Method A does **not** read caller source. A newer version is not a break; `review_changelog` means "look at the changelog before bumping a pin", not "caller defect".

Method B does **not** treat unused export changes as caller defects. Missing/partial/conflicting source stays `unknown`.

## Coarse buckets (default `--mode coarse`)

Kill is about the **operator move**, not the raw string.

| Raw `nextAction` | Coarse bucket |
| --- | --- |
| `action`, `upgrade_with_edits`, `review_breakages`, `review_changelog`, `bump_pin`, `refresh_agent_tool_notes`, `upgrade_now`, `schedule_upgrade`, `monitor` | `action` |
| `no_action`, `none`, `skip`, `unchanged` | `no_action` |
| `unknown`, `partial`, `missing`, `error`, `stale`, `stale_baseline`, `timed_out`, null, anything else | `unknown` |

`--mode exact` compares raw strings and is diagnostic only. `review_changelog` vs `action` would always "keep" in exact mode, which would make a product kill almost unreachable.

## Pair predicate (two JSON files)

```
changed := coarse(A) ≠ coarse(B)     # default
verdict := unknown if either side unreadable
        := keep    if changed
        := kill    if not changed
```

A pair `kill` is a **kill-signal**, not a product kill by itself.

## Product predicate (required cases A and B)

Required ids default to the suite's `required` list (real-ab: `real-a`, `real-b`).

```
if any required case is missing or unreadable:
    verdict = unknown     # do not kill on incomplete evidence
else if no required case has changed == true:
    verdict = kill        # B never changed the decision vs A
else:
    verdict = keep        # at least one required case changed the operator move
```

Product `kill` means: stop packaging usage-binding as a paid job. Record negative evidence. Do not invent paid demand.

Product `unknown` on `fixtures/suites/real-ab.json` is the Stage-1 state until c11/c12 (or the integrator) drop decision JSON into `fixtures/drop-in/real-a/` and `real-b/`.

## What counts as "binding added value"

Two keep directions, both synthetic and labeled:

1. **Withhold.** Skim says `review_changelog` on a major bump whose changelog screams `BREAKING CHANGE`; binding says `no_action` because the removed export is unused.
2. **Catch.** Skim says `no_action` on a patch whose changelog is silent; binding says `action` because a used export's signature changed.

If real cases A and B only ever produce (1) neither of those, and (2) matching coarse buckets, the suite kills.

## Non-claims

- A new version is not itself a break.
- An unused export change is not a caller defect.
- Keyword scan is a stub regex, not changelog understanding and not TypeScript analysis.
- Synthetic stand-ins are not real-source cases A/B.
- No paid claims. `payment.attempted` is always false.
