#!/usr/bin/env bash
# DM Terminal 5 batch: reliability tip wallet-enrich + python:consumer + full suite.
# Locator: scripts/dm-t5-merchant-batch.sh on codex/n5-merchant-baseline-reliability-20261105
#
# Historical pins: page-change-http.mounted and caller-result-client.distribution
# require identified revisions (git show / merge-base --is-ancestor). A depth-1
# checkout is a normal-environment miss (git exit 128). Repair with ordinary
# full writer-history for the admitted tip/branch, plus explicit off-ancestry
# object fetches. Do not use deepen=N (can follow origin HEAD / default line).
# Verify exact relevant ancestry and blobs before suites.
#
# loopback-profile.json: public-acquisition/engine.test.mjs rewrites it as a
# generated evidence artifact (not claim/payment path). Under default parallel
# npm test that dirty tree is concurrent generated state, not a product bug.
# Run with --test-concurrency=2 (accepted 7475eaad consumer) and restore HEAD
# bytes after the suite.
set -u
REPO="${1:-/tmp/n4-team/dm/repo}"
OUT="${2:-/tmp/n4-team/dm}"
mkdir -p "$OUT"
cd "$REPO" || exit 90
HEAD=$(git rev-parse HEAD)
TREE=$(git rev-parse 'HEAD^{tree}')
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo DETACHED)
WRITER_REF="$BRANCH"
if [[ "$WRITER_REF" == "HEAD" || "$WRITER_REF" == "DETACHED" || -z "$WRITER_REF" ]]; then
  WRITER_REF=codex/n5-merchant-baseline-reliability-20261105
fi
{
  echo "DM_T5_BATCH"
  echo "cwd=$PWD"
  echo "branch=$BRANCH"
  echo "writer_ref=$WRITER_REF"
  echo "head=$HEAD"
  echo "tree=$TREE"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | tee "$OUT/batch.meta"

SHALLOW=$(git rev-parse --is-shallow-repository 2>/dev/null || echo unknown)
echo "shallow_before=$SHALLOW" | tee -a "$OUT/batch.meta"
if [[ "$SHALLOW" == "true" ]]; then
  # Full writer-history for this admitted tip (not deepen against origin HEAD).
  git fetch --unshallow origin "$HEAD" >"$OUT/git-unshallow.log" 2>&1 \
    || git fetch --unshallow origin "refs/heads/${WRITER_REF}:refs/remotes/origin/${WRITER_REF}" >"$OUT/git-unshallow.log" 2>&1 \
    || git fetch origin "$WRITER_REF" >"$OUT/git-unshallow.log" 2>&1
  echo "writer_history_fetch_exit=$?" | tee -a "$OUT/batch.meta"
  tail -n 8 "$OUT/git-unshallow.log" | tee -a "$OUT/batch.meta" || true
fi

# Off-ancestry pin required by caller recovery (not an ancestor of this tip).
OFF_PINS=(
  6ea1294b8693f2c655d239f0870800e93bfff040
)
for pin in "${OFF_PINS[@]}"; do
  if git cat-file -e "${pin}^{commit}" 2>/dev/null; then
    echo "offpin_present=$pin" | tee -a "$OUT/batch.meta"
  else
    git fetch origin "$pin" >"$OUT/git-fetch-${pin}.log" 2>&1
    echo "offpin_fetch_exit=$pin:$?" | tee -a "$OUT/batch.meta"
  fi
done

# Must be ancestors of HEAD (mounted / sealed-archive bases).
ANCESTOR_PINS=(
  94e45050e9d992ca2eb613cfb3850676217b9fb1
  a6978f989a3bc754421884a3d260be834a84c73a
  d9e5cde379cf7798f473d0cc6bf2139c9ec857d9
  7138c170c7c5d06dae0568466b7a93b77439bbda
  ab5bf51b60c7fa6e2d3587fcac23b26f00872b65
  e0daf4d9a9e775a8180ae0aa9bee351c10b850c8
)
# Exact blobs exercised by the historical suites.
BLOB_SPECS=(
  94e45050e9d992ca2eb613cfb3850676217b9fb1:caller-result-client/export/public/manifest.json
  6ea1294b8693f2c655d239f0870800e93bfff040:public-acquisition/manifest.json
)

PIN_MISS=0
for pin in "${ANCESTOR_PINS[@]}" "${OFF_PINS[@]}"; do
  if git cat-file -e "${pin}^{commit}" 2>/dev/null; then
    echo "pin_ok=$pin" | tee -a "$OUT/batch.meta"
  else
    echo "pin_missing=$pin" | tee -a "$OUT/batch.meta"
    PIN_MISS=1
  fi
done
for pin in "${ANCESTOR_PINS[@]}"; do
  if git merge-base --is-ancestor "$pin" HEAD 2>/dev/null; then
    echo "ancestor_ok=$pin" | tee -a "$OUT/batch.meta"
  else
    echo "ancestor_miss=$pin" | tee -a "$OUT/batch.meta"
    PIN_MISS=1
  fi
done
for spec in "${BLOB_SPECS[@]}"; do
  if git cat-file -e "$spec" 2>/dev/null; then
    echo "blob_ok=$spec" | tee -a "$OUT/batch.meta"
  else
    echo "blob_miss=$spec" | tee -a "$OUT/batch.meta"
    PIN_MISS=1
  fi
done
if [[ $PIN_MISS -ne 0 ]]; then
  echo "history_preflight=fail (full writer-history + off-ancestry pins required)" | tee -a "$OUT/batch.meta"
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

# Match the earlier accepted full-suite consumer (concurrency=2).
npm test -- --test-concurrency=2 >"$OUT/full.log" 2>&1
FULL=$?
echo "cmd=npm test -- --test-concurrency=2 exit=$FULL" | tee -a "$OUT/batch.meta"
rg -n '^# (tests|pass|fail|cancelled|skipped|todo|duration_ms)' "$OUT/full.log" | tee -a "$OUT/batch.meta" || true
tail -n 40 "$OUT/full.log" | tee -a "$OUT/batch.meta"

# Generated evidence artifact from engine.test.mjs; restore committed bytes.
if git diff --quiet -- public-acquisition/loopback-profile.json 2>/dev/null; then
  echo "loopback_profile=clean" | tee -a "$OUT/batch.meta"
else
  echo "loopback_profile=dirty_after_suite (generated evidence; restoring HEAD)" | tee -a "$OUT/batch.meta"
  git restore --source=HEAD -- public-acquisition/loopback-profile.json
  echo "loopback_profile_restore_exit=$?" | tee -a "$OUT/batch.meta"
fi

echo "finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT/batch.meta"
echo "A2_EXIT=$A2 B2_EXIT=$B2 FULL_EXIT=$FULL" | tee -a "$OUT/batch.meta"
if [[ $A2 -ne 0 || $B2 -ne 0 || $FULL -ne 0 ]]; then exit 1; fi
exit 0
