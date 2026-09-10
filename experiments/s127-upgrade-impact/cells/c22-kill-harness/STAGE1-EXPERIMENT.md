# Stage-1 no-payment experiment: insert the packet before bumping a pin

Label: internal / owner-QA. Not organic demand. Assignment spend **$0**.

## Hypothesis

An agent that is about to bump a dependency pin (or refresh tool notes after a registry skim) will take a **different next step** when it first reads a usage-binding packet, versus reading only "a newer version exists" plus a changelog skim.

## Existing workflow to wrap (do not fork)

S122 already answers "what do I do about this registry observation?" with
`review_changelog | bump_pin | refresh_agent_tool_notes | no_action`
(`experiments/s122-application-jobs`, recipe `npm-cli-release-followup`). SameDayDesk `source-change-alert` diffs named fields only.

S127 adds **caller usage bound to exportDiff**. Insert that packet **immediately before** the bump-pin / notes-refresh step, not after.

## Setup (offline)

1. Pick one pin the operator already owns. Do not invent a customer.
2. Capture method A:
   - Preferred: run the S122 recipe (or this cell's skim stub) against the pin's old/new versions and any changelog text on disk.
   - This cell: `node harness.mjs skim <registry-skim-input.json> --out fixtures/out/method-a.json`
3. Capture method B:
   - Run the pack analyze CLI (integrator-wired) on the caller tree + old/new package trees.
   - Or drop a `s127.upgrade-impact.packet.v1` JSON with `summary.nextAction` already filled.
4. Compare **before** changing `package.json` / lockfile:

```bash
cd experiments/s127-upgrade-impact/cells/c22-kill-harness
node harness.mjs compare path/to/method-a.json path/to/method-b.json
```

5. Do not pass payment flags. Do not `--replay-payment`. `execute` stays false. Do not merge to the default branch as part of this experiment.

## Insertion seam (agent runbook)

Suggested order inside an existing "upgrade this pin" skill or recipe:

1. Observe registry (version document or lockfile-resolved new version). Clock is operator-supplied; never invented.
2. Skim changelog if present (method A). Partial changelog → `unknown`, not action.
3. **Run usage-binding packet (method B).**
4. **Run this harness** on the two decision JSONs.
5. Only then decide whether to bump the pin:
   - Harness `keep` on this pair and B=`no_action`: do **not** treat the bump as a caller defect. Changelog noise / unused removals are not a reason to edit the caller.
   - Harness `keep` and B=`action`: review `summary.actionableChanges` / bindings with `decision=action` before bumping; those symbols are used.
   - Harness `kill` on this pair: binding agreed with the skim bucket; the packet did not change the operator move for this pin.
   - Harness `unknown`: missing/partial/conflicting source. Do not claim action. Do not bump on a fabricated break.

## Real cases A/B (product kill)

c11-real-a and c12-real-b own the real-source trees. This cell does not write them.

When those packets exist, copy **only the decision JSON** into:

- `fixtures/drop-in/real-a/method-a.json` and `method-b.json`
- `fixtures/drop-in/real-b/method-a.json` and `method-b.json`

Then:

```bash
node harness.mjs suite fixtures/suites/real-ab.json
```

| Suite verdict | Meaning | Paid packaging |
| --- | --- | --- |
| `keep` | B changed the coarse decision on at least one of real A/B | Eligible to keep experimenting (still $0 this assignment) |
| `kill` | B never changed the decision on real A and B | Stop. Record negative evidence. Do not list as a paid job |
| `unknown` | A required file is missing or unreadable | Do not kill; do not sell. Incomplete evidence |

Until drop-ins exist, `real-ab` is **unknown**. That is not a keep and not a kill.

## Success signals (no payment)

- An operator (or cold consumer) re-runs the compare after a second snapshot without overwriting sequence-1.
- At least one real case A/B changes the coarse nextAction vs skim.
- No paid x402 / SameDayDesk extract / merchant call is required for the offline path.

## Kill / revise

- If the only observed behavior is our own agents chatting about packets while `real-ab` stays unknown, do not package.
- If `real-ab` returns `kill`, stop packaging as a paid job. Binding added no different operator move than registry + changelog skim.
- Do not invent customers, settle fake demand, or open an always-on watcher.

## Cost honesty

Offline runs use operator compute. Free live registry GETs (if a later cell captures them) are not zero marginal cost and must be labeled `live-capture` with URL / time / sha / coverage. This cell ships **synthetic** fixtures only. Documented future list prices stay **not invoked**.
