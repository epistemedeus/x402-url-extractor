# Receipts

Not buyers. Not willingness-to-pay. Stage-1 experiment receipts.

## Pins

| Tree | Pin | Role |
| --- | --- | --- |
| Merchant `x402-url-extractor` | `1a23b648e3c5f90bc009accb85972e2db6e22051` | public product; this pack lives under `experiments/s122-application-jobs` |
| Branch | `codex/s122-useful-application-jobs-20260910` | already checked out; no default-branch merge |
| SameDayDesk | `40da1745f73df5e66752ec761b9755921c35febd` | read-only reference (`/tmp/s122/samedaydesk`) |
| agent-task-kit | 0.1.2 at `/tmp/s122/task-kit/package` | continue capture/validate/compare/prepare/consume |

Merchant API / brand / homepage were not modified.

## Evidence capture

- Original snapshots: `evidence/snapshots/` and duplicate
  `fixtures-source-snapshots/`
- `CAPTURED_AT_UTC.txt`: `2026-09-10T09:54:59Z`
- Working fixtures: `fixtures/` (materialized by `scripts/materialize-fixtures.mjs`)

## Cells and native overlap

Parent kept coherent source/receipt context and implemented the pack in this
session. Suggested concurrent cells (evidence, recipes A+B, recipe C + continue,
tests, product page) were **not** dispatched as isolated workers: recipe
decision policy, fixtures, tests, and the one-page experiment doc had to stay
identical. Sampled peak native overlap: **1** parent. No marker/load-only
tasks. (Not a shell-count of background jobs.)

## Test commands and results

Offline. Network not used.

```bash
cd experiments/s122-application-jobs
node --test test/*.test.mjs
```

Recorded after implementation (Node v22.23.2):

```
# tests 36
# pass 36
# fail 0
```

Cold CLI (also asserted in `test/cli-cold-path.test.mjs`):

```bash
node scripts/cli.mjs --list
node scripts/cli.mjs --recipe npm-cli-release-followup \
  --prior fixtures/npm-vercel/prior.seq-1.json \
  --current-fixture fixtures/npm-vercel/current.json \
  --operator fixtures/npm-vercel/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z
# outcome=changed nextAction=review_changelog delta=minor

node scripts/cli.mjs --recipe runtime-eol-watch \
  --prior fixtures/eol-nodejs/prior.seq-1.json \
  --current-fixture fixtures/eol-nodejs/current.json \
  --operator fixtures/eol-nodejs/operator.json \
  --schedule monthly --clock 2026-09-10T09:54:59.000Z --horizon-days 90
# outcome=changed nextAction=upgrade_now deadlineCrossed=true (source rows unchanged)

node scripts/cli.mjs --recipe agent-cli-release-followup \
  --prior fixtures/npm-claude-code/prior.seq-1.json \
  --current-fixture fixtures/npm-claude-code/current.json \
  --operator fixtures/npm-claude-code/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z
# outcome=changed nextAction=refresh_agent_tool_notes delta=patch followUp=bump_pin
```

## Cost

Assignment spend: 0. Merchant extract 0.005 / batch 0.01 USDC listed prices
were documented and not invoked.
