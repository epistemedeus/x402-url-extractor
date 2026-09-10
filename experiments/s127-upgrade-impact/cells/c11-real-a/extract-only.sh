#!/bin/sh
# Extract official npm tarballs with tar only. Never npm install.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/../../fixtures/real-a" && pwd)"
OUT="${1:-"$ROOT/extracted"}"
mkdir -p "$OUT/6.3.0" "$OUT/8.4.2"
tar -xzf "$ROOT/tarballs/path-to-regexp-6.3.0.tgz" -C "$OUT/6.3.0"
tar -xzf "$ROOT/tarballs/path-to-regexp-8.4.2.tgz" -C "$OUT/8.4.2"
echo "extracted to $OUT (no lifecycle scripts)"
