#!/usr/bin/env bash
# Durable T5 launcher: bind OUT and PID in the same shell scope (absolute OUT).
# Avoid `OUT=... && nohup ... &` patterns that can leave OUT unset for a
# foreground collector. Usage:
#   scripts/dm-t5-merchant-launch.sh /abs/repo /abs/out
set -u
REPO="${1:?absolute repo path}"
OUT="${2:?absolute out directory}"
SCRIPT="${REPO}/scripts/dm-t5-merchant-batch.sh"
mkdir -p "$OUT"
cd "$OUT" || exit 90
nohup bash "$SCRIPT" "$REPO" "$OUT" >"$OUT/batch.nohup" 2>&1 &
PID=$!
{
  echo "PID=$PID"
  echo "OUT=$OUT"
  echo "REPO=$REPO"
  echo "SCRIPT=$SCRIPT"
  echo "head=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "script_sha256=$(sha256sum "$SCRIPT" | awk '{print $1}')"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | tee "$OUT/launch.meta"
