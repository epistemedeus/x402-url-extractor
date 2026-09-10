#!/usr/bin/env bash
# Clean-install / cold-run for S122 application jobs. Spends $0. No npm install.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "== list recipes =="
node scripts/cli.mjs --list
echo "== tests (offline) =="
node --test test/*.test.mjs
echo "== Job A: npm CLI release follow-up (vercel) =="
node scripts/cli.mjs --recipe npm-cli-release-followup \
  --prior fixtures/npm-vercel/prior.seq-1.json \
  --current-fixture fixtures/npm-vercel/current.json \
  --operator fixtures/npm-vercel/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z
echo "== Job B: runtime EOL watch (Node.js) =="
node scripts/cli.mjs --recipe runtime-eol-watch \
  --prior fixtures/eol-nodejs/prior.seq-1.json \
  --current-fixture fixtures/eol-nodejs/current.json \
  --operator fixtures/eol-nodejs/operator.json \
  --schedule monthly --clock 2026-09-10T09:54:59.000Z --horizon-days 90
echo "== Job C: agent CLI release follow-up (claude-code) =="
node scripts/cli.mjs --recipe agent-cli-release-followup \
  --prior fixtures/npm-claude-code/prior.seq-1.json \
  --current-fixture fixtures/npm-claude-code/current.json \
  --operator fixtures/npm-claude-code/operator.json \
  --schedule weekly --clock 2026-09-10T09:54:59.000Z
echo "done"
