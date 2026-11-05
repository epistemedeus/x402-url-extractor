#!/usr/bin/env bash
# DM Terminal 5 batch: reliability tip wallet-enrich + python:consumer + full suite.
# Locator: scripts/dm-t5-merchant-batch.sh on codex/n5-merchant-baseline-reliability-20261105
set -u
REPO="${1:-/tmp/n4-team/dm/repo}"
OUT="${2:-/tmp/n4-team/dm}"
mkdir -p "$OUT"
cd "$REPO" || exit 90
HEAD=$(git rev-parse HEAD)
TREE=$(git rev-parse 'HEAD^{tree}')
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo DETACHED)
{
  echo "DM_T5_BATCH"
  echo "cwd=$PWD"
  echo "branch=$BRANCH"
  echo "head=$HEAD"
  echo "tree=$TREE"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | tee "$OUT/batch.meta"

if [[ ! -d node_modules ]]; then
  npm ci >"$OUT/npm-ci.log" 2>&1
  echo "npm_ci_exit=$?" | tee -a "$OUT/batch.meta"
fi

node --test wallet-enrich-contract.http.test.mjs >"$OUT/a2.log" 2>&1
A2=$?
echo "cmd=node --test wallet-enrich-contract.http.test.mjs exit=$A2" | tee -a "$OUT/batch.meta"
tail -n 20 "$OUT/a2.log" | tee -a "$OUT/batch.meta"

npm run python:consumer >"$OUT/b2.log" 2>&1
B2=$?
echo "cmd=npm run python:consumer exit=$B2" | tee -a "$OUT/batch.meta"
tail -n 8 "$OUT/b2.log" | tee -a "$OUT/batch.meta"

npm test >"$OUT/full.log" 2>&1
FULL=$?
echo "cmd=npm test exit=$FULL" | tee -a "$OUT/batch.meta"
# node --test summary lines
rg -n '^# (tests|pass|fail|cancelled|skipped|todo|duration_ms)' "$OUT/full.log" | tee -a "$OUT/batch.meta" || true
tail -n 40 "$OUT/full.log" | tee -a "$OUT/batch.meta"
echo "finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT/batch.meta"
echo "A2_EXIT=$A2 B2_EXIT=$B2 FULL_EXIT=$FULL" | tee -a "$OUT/batch.meta"
# non-zero if any step failed
if [[ $A2 -ne 0 || $B2 -ne 0 || $FULL -ne 0 ]]; then exit 1; fi
exit 0
