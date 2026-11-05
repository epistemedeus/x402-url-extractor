#!/usr/bin/env bash
# DM Terminal 5 batch: reliability tip wallet-enrich + python:consumer + full suite.
# Locator: scripts/dm-t5-merchant-batch.sh on codex/n5-merchant-baseline-reliability-20261105
#
# Historical pins: page-change-http.mounted and caller-result-client.distribution
# call git show / merge-base --is-ancestor on identified revisions. A depth-1
# checkout is a normal-environment miss for those tests (git exit 128). This
# script deepens history and fetches the off-ancestry caller pin before suites.
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

SHALLOW=$(git rev-parse --is-shallow-repository 2>/dev/null || echo unknown)
echo "shallow_before=$SHALLOW" | tee -a "$OUT/batch.meta"
# Deepen enough for e0daf4d9 (~372) and sealed-archive pins (~157).
if [[ "$SHALLOW" == "true" ]]; then
  git fetch --deepen=400 origin HEAD >/dev/null 2>"$OUT/git-deepen.err"
  echo "deepen_exit=$?" | tee -a "$OUT/batch.meta"
  if [[ -s "$OUT/git-deepen.err" ]]; then
    tail -n 5 "$OUT/git-deepen.err" | tee -a "$OUT/batch.meta"
  fi
fi
# 6ea1294b is required by caller recovery and is not an ancestor of this tip.
OFF_PIN=6ea1294b8693f2c655d239f0870800e93bfff040
if ! git cat-file -e "${OFF_PIN}^{commit}" 2>/dev/null; then
  git fetch --depth=1 origin "$OFF_PIN" >/dev/null 2>"$OUT/git-fetch-offpin.err"
  echo "offpin_fetch_exit=$?" | tee -a "$OUT/batch.meta"
else
  echo "offpin_fetch_exit=already_present" | tee -a "$OUT/batch.meta"
fi
REQUIRED_PINS=(
  94e45050e9d992ca2eb613cfb3850676217b9fb1
  6ea1294b8693f2c655d239f0870800e93bfff040
  a6978f989a3bc754421884a3d260be834a84c73a
  d9e5cde379cf7798f473d0cc6bf2139c9ec857d9
  7138c170c7c5d06dae0568466b7a93b77439bbda
  ab5bf51b60c7fa6e2d3587fcac23b26f00872b65
)
PIN_MISS=0
for pin in "${REQUIRED_PINS[@]}"; do
  if git cat-file -e "${pin}^{commit}" 2>/dev/null; then
    echo "pin_ok=$pin" | tee -a "$OUT/batch.meta"
  else
    echo "pin_missing=$pin" | tee -a "$OUT/batch.meta"
    PIN_MISS=1
  fi
done
if [[ $PIN_MISS -ne 0 ]]; then
  echo "history_preflight=fail (depth-1 or incomplete history; deepen/fetch required pins)" | tee -a "$OUT/batch.meta"
  echo "finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT/batch.meta"
  exit 91
fi
echo "history_preflight=ok" | tee -a "$OUT/batch.meta"
echo "shallow_after=$(git rev-parse --is-shallow-repository 2>/dev/null || echo unknown)" | tee -a "$OUT/batch.meta"

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
