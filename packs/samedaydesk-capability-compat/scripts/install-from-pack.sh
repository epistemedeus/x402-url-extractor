#!/bin/bash
# Pack this package, install the tarball into a fresh directory, and run the bin.
# Usage: install-from-pack.sh [work-dir]
set -euo pipefail

PACK="$(cd "$(dirname "$0")/.." && pwd)"
TGZ="samedaydesk-capability-compat-0.1.0.tgz"
WORKDIR="${1:-}"
CLEANUP=0
if [ -z "$WORKDIR" ]; then
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/capability-compat-install.XXXXXX")"
  CLEANUP=1
fi

cd "$PACK"
npm pack
test -f "$PACK/$TGZ"

mkdir -p "$WORKDIR"
cd "$WORKDIR"
npm install --ignore-scripts --prefer-offline --no-fund --no-audit "$PACK/$TGZ"
npx --no-install capability-compat help
npx --no-install capability-compat pin
npx --no-install capability-compat compare-acquisition --tarball "$PACK/$TGZ" --pack-dir "$PACK"

if [ "$CLEANUP" -eq 1 ]; then
  rm -rf "$WORKDIR"
fi
