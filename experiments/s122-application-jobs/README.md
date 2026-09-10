# S122 application job recipes

Stage-1 experiment. Three one-shot **buyer-facing application jobs** that sit on
the existing SameDayDesk recurring-job vocabulary and, where a second snapshot
exists, on agent-task-kit 0.1.2 `continue`. Not a new daemon, marketplace,
protocol, or payment engine.

Assignment spend: **$0**. Offline default. No paid x402 / SameDayDesk extract /
Neomorphic calls.

| Recipe | Official free JSON | Buyer question | Next action |
| --- | --- | --- | --- |
| `npm-cli-release-followup` | `https://registry.npmjs.org/vercel` | My pin and agent tool notes still cite vercel 59.9.1; registry latest is 59.15.1. What do I do? | `review_changelog` / `bump_pin` / `refresh_agent_tool_notes` / `no_action` |
| `runtime-eol-watch` | `https://endoflife.date/api/nodejs.json` | Node 20/22/24 vs my clock and horizon. Upgrade now? | `upgrade_now` / `schedule_upgrade` / `monitor` / `no_action` |
| `agent-cli-release-followup` | `https://registry.npmjs.org/@anthropic-ai/claude-code` | Claude Code 2.1.260 → 2.1.267. Refresh the runbook, bump the pin, or ignore the patch? | `refresh_agent_tool_notes` / `bump_pin` / `review_changelog` / `no_action` |

Rejected hypotheses (crates.io, PyPI, GitHub monorepo releases, HTML changelog scrape, paid extract): [NEGATIVE-EVIDENCE.md](./NEGATIVE-EVIDENCE.md).

Product/experiment decisions: [PRODUCT-EXPERIMENT.md](./PRODUCT-EXPERIMENT.md).

## Clean install (literal)

Requires Node.js 20+. No `npm install`. From this directory, or from the merchant root with the paths below.

```bash
cd experiments/s122-application-jobs
node --test test/*.test.mjs
node scripts/cli.mjs --list
```

Cold runs (operator clock and schedule are required; the pack does not invent them):

```bash
node scripts/cli.mjs --recipe npm-cli-release-followup \
  --prior fixtures/npm-vercel/prior.seq-1.json \
  --current-fixture fixtures/npm-vercel/current.json \
  --operator fixtures/npm-vercel/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z

node scripts/cli.mjs --recipe runtime-eol-watch \
  --prior fixtures/eol-nodejs/prior.seq-1.json \
  --current-fixture fixtures/eol-nodejs/current.json \
  --operator fixtures/eol-nodejs/operator.json \
  --schedule monthly --clock 2026-09-10T09:54:59.000Z --horizon-days 90

node scripts/cli.mjs --recipe agent-cli-release-followup \
  --prior fixtures/npm-claude-code/prior.seq-1.json \
  --current-fixture fixtures/npm-claude-code/current.json \
  --operator fixtures/npm-claude-code/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z
```

One-shot helper: `bash scripts/clean-install.sh`.

## SameDayDesk seam

Do not fork a parallel recipe CLI. SameDayDesk already diffs named fields
(`source-change-alert`). These adapters add **decision policy** (semver, pin vs
notes, days-to-eol vs horizon) and keep the same prior/outcome/recovery words.
See `recipes/adapters/samedaydesk-seam.md`.

Reference SameDayDesk (read-only, pin `40da1745f73df5e66752ec761b9755921c35febd`):

```bash
node /tmp/s122/samedaydesk/tools/recurring-job-recipes/cli.mjs --list
```

## Task-kit continue (second snapshot)

Optional. Set `TASK_KIT_ROOT` if the 0.1.2 package is not at `/tmp/s122/task-kit/package`.

```bash
node scripts/cli.mjs --recipe npm-cli-release-followup \
  --prior fixtures/npm-vercel/prior.seq-1.json \
  --current-fixture fixtures/npm-vercel/current.json \
  --operator fixtures/npm-vercel/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z \
  --continue-out /tmp/s122-continue-seq2 --revision seq-2 --phase followup

node scripts/cli.mjs continue correction \
  --recipe npm-cli-release-followup \
  --packet /tmp/s122-continue-seq2 \
  --prior fixtures/npm-vercel/prior.seq-1.json \
  --current-fixture fixtures/npm-vercel/second-snapshot-version-doc.json \
  --operator fixtures/npm-vercel/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z \
  --out-dir /tmp/s122-continue-correction
```

`execute` stays false. The approved-state file is data, not authorization.

## Cost boundary

- This assignment spends 0.
- Offline compare: operator CPU/disk/wall time are `costs_unknown`.
- Optional `--live-official` GET of the three allowlisted JSON URLs: no merchant charge; egress still `costs_unknown`. Tests do not perform it.
- A **future** paid freshness call would use merchant listed prices **without being invoked here**: extract **0.005 USDC**, batch **0.01 USDC**.

## Honesty

- Labels: `fixture` | `owner-qa` | `live-replay`.
- No buyers, willingness-to-pay, or always-on watcher claims.
- Priors are immutable. Write a new sequenced artifact; never overwrite sequence-1.
- Network is off unless `--live-official`.
