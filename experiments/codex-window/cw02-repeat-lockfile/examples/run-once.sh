#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE_DIR=${CW02_STATE_DIR:-"$HERE/.state"}

exec node "$HERE/bin/repeat-lockfile.mjs" prepare \
  --job "$HERE/examples/npm-change.job.json" \
  --state-dir "$STATE_DIR"
