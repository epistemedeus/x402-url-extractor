#!/bin/bash
# Cursor VM run for samedaydesk-capability-compat.
# Checkout: epistemedeus/x402-url-extractor feature branch
#   codex/n12-compat-interop-corpus-20261112 (stacked on
#   codex/n12-compat-changed-source-20261112 / #276, on #274).
# The consumer now also depends on the samedaydesk-interop-corpus tarball, so
# this script packs it too. The corpus has its own run in
# packs/samedaydesk-interop-corpus/scripts/vm-run.sh.
# Merchant lockfile dependencies must already be installed at repo root from
# pin e90676f48da875c5e0f475f57f7774de947b75a7 (npm ci at the repo root).
# Do not publish, merge, or deploy from this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PACK="$ROOT/packs/samedaydesk-capability-compat"
CONSUMER="$ROOT/packs/samedaydesk-capability-compat-consumer"
CORPUS="$ROOT/packs/samedaydesk-interop-corpus"
TGZ="samedaydesk-capability-compat-0.1.0.tgz"
CORPUS_TGZ="samedaydesk-interop-corpus-0.1.0.tgz"
SCHEMA="schema/capability-provider.preview.v1.schema.json"

cd "$PACK"
npm pack
test -f "$PACK/$TGZ"
test -f "$PACK/$SCHEMA"
TGZ_SHA256="$(sha256sum "$PACK/$TGZ" | awk '{print $1}')"
SCHEMA_SHA256="$(sha256sum "$PACK/$SCHEMA" | awk '{print $1}')"
echo "tgz sha256 ${TGZ_SHA256}  ${TGZ}"
echo "schema sha256 ${SCHEMA_SHA256}  ${SCHEMA}"

cd "$CORPUS"
npm pack
test -f "$CORPUS/$CORPUS_TGZ"
echo "tgz sha256 $(sha256sum "$CORPUS/$CORPUS_TGZ" | awk '{print $1}')  ${CORPUS_TGZ}"

cd "$CONSUMER"
npm install --ignore-scripts --prefer-offline --no-fund --no-audit \
  "file:../samedaydesk-capability-compat/${TGZ}" \
  "file:../samedaydesk-interop-corpus/${CORPUS_TGZ}"

cd "$ROOT"
export PAGE_CHANGE_HTTP_ENABLED=1
node --test --test-concurrency=1 \
  packs/samedaydesk-capability-compat/test/install-from-pack.test.mjs \
  packs/samedaydesk-capability-compat/test/installed-vs-hosted.test.mjs \
  packs/samedaydesk-capability-compat/test/describe-capabilities.test.mjs \
  packs/samedaydesk-capability-compat/test/source-drift.test.mjs \
  packs/samedaydesk-capability-compat-consumer/test/page-change-compat.test.mjs \
  packs/samedaydesk-capability-compat-consumer/test/interop-corpus.test.mjs

echo "tgz sha256 ${TGZ_SHA256}  ${TGZ}"
echo "schema sha256 ${SCHEMA_SHA256}  ${SCHEMA}"
