#!/bin/bash
# Cursor VM run for samedaydesk-capability-compat.
# Checkout: epistemedeus/x402-url-extractor feature branch
#   codex/n12-compat-capability-pack-20261112
# Merchant lockfile dependencies must already be installed at repo root from
# pin e90676f48da875c5e0f475f57f7774de947b75a7 (npm ci at the repo root).
# Do not publish, merge, or deploy from this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PACK="$ROOT/packs/samedaydesk-capability-compat"
CONSUMER="$ROOT/packs/samedaydesk-capability-compat-consumer"
TGZ="samedaydesk-capability-compat-0.1.0.tgz"

cd "$PACK"
npm pack
test -f "$PACK/$TGZ"

cd "$CONSUMER"
npm install --ignore-scripts --prefer-offline --no-fund --no-audit "file:../samedaydesk-capability-compat/${TGZ}"

cd "$ROOT"
export PAGE_CHANGE_HTTP_ENABLED=1
node --test --test-concurrency=1 \
  packs/samedaydesk-capability-compat/test/install-from-pack.test.mjs \
  packs/samedaydesk-capability-compat/test/installed-vs-hosted.test.mjs \
  packs/samedaydesk-capability-compat-consumer/test/page-change-compat.test.mjs
