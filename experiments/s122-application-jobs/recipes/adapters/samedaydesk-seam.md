# SameDayDesk seam (adapter, not a fork)

These application recipes reuse SameDayDesk recurring-job vocabulary:

- immutable prior `samedaydesk.recurring-job-prior.v1`
- outcomes `unchanged | changed | partial | stale_baseline | error | timed_out`
- recovery actions `keep_prior | review_and_sequence | keep_partial_rows | refresh_baseline | bounded_retry_then_stop`
- one-shot CLI, operator clock and schedule hint, no daemon
- payment replay blocked

They do **not** copy SameDayDesk recipe files onto the SameDayDesk default branch.

## Why `source-change-alert` is not enough

SameDayDesk can already diff named fields:

```bash
node /tmp/s122/samedaydesk/tools/recurring-job-recipes/cli.mjs --recipe source-change-alert \
  --prior experiments/s122-application-jobs/fixtures/npm-vercel/prior.seq-1.json \
  --current-fixture experiments/s122-application-jobs/fixtures/npm-vercel/current.json \
  --fields version \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z
```

That reports a field diff. It does not:

- classify semver delta
- keep pin vs notes vs current as separate operator facts
- emit `review_changelog | bump_pin | refresh_agent_tool_notes | no_action`
- treat an operator clock crossing an EOL date as a change when source rows are unchanged

Use this pack when the buyer question is **what to do next**.

## Task-kit continue seam

Second-snapshot correction uses agent-task-kit 0.1.2 `continue` capture / validate / compare / prepare / consume. Kit API is preserved. `execute` stays false. An approved-state file is data, not authorization.
