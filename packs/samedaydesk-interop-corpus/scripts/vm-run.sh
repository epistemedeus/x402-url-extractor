#!/bin/bash
# Cursor VM run for samedaydesk-interop-corpus.
# Checkout: epistemedeus/x402-url-extractor feature branch
#   codex/n12-compat-interop-corpus-20261112 (stacked on
#   codex/n12-compat-changed-source-20261112 / #276).
# Merchant lockfile dependencies must already be installed at repo root from
# pin e90676f48da875c5e0f475f57f7774de947b75a7 (npm ci at the repo root).
# Installs the pinned official runner @modelcontextprotocol/conformance
# 0.2.0-alpha.12 from this package's lockfile. Do not publish, merge, or deploy.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PACK="$ROOT/packs/samedaydesk-capability-compat"
CORPUS="$ROOT/packs/samedaydesk-interop-corpus"
CONSUMER="$ROOT/packs/samedaydesk-capability-compat-consumer"
OUT="${INTEROP_OUT:-$(mktemp -d -t interop-corpus-XXXXXX)}"
PACK_TGZ="samedaydesk-capability-compat-0.1.0.tgz"
CORPUS_TGZ="samedaydesk-interop-corpus-0.1.0.tgz"
RUNNER_PKG="$CORPUS/node_modules/@modelcontextprotocol/conformance"

fail() { echo "vm-run: $*" >&2; exit 2; }

echo "head $(git -C "$ROOT" rev-parse HEAD)"
echo "node $(node --version)  npm $(npm --version)"

cd "$PACK" && npm pack >/dev/null || fail "npm pack failed in $PACK"
cd "$CORPUS" && npm pack >/dev/null || fail "npm pack failed in $CORPUS"
PACK_SHA="$(sha256sum "$PACK/$PACK_TGZ" | awk '{print $1}')"
CORPUS_SHA="$(sha256sum "$CORPUS/$CORPUS_TGZ" | awk '{print $1}')"
echo "tgz sha256 ${PACK_SHA}  ${PACK_TGZ}"
echo "tgz sha256 ${CORPUS_SHA}  ${CORPUS_TGZ}"

cd "$CORPUS" && npm ci --ignore-scripts --no-fund --no-audit || fail "npm ci failed in $CORPUS"
RUNNER_VERSION="$(node -p "require('$RUNNER_PKG/package.json').version")"
RUNNER_ENTRY_SHA="$(sha256sum "$RUNNER_PKG/dist/index.js" | awk '{print $1}')"
PIN_ENTRY_SHA="$(node -p "require('$CORPUS/PIN.json').officialRunner.entrySha256")"
echo "official runner @modelcontextprotocol/conformance ${RUNNER_VERSION}"
echo "runner dist/index.js sha256 ${RUNNER_ENTRY_SHA} (pin ${PIN_ENTRY_SHA})"
[ "$RUNNER_VERSION" = "0.2.0-alpha.12" ] || fail "runner version ${RUNNER_VERSION} is not the pin"
[ "$RUNNER_ENTRY_SHA" = "$PIN_ENTRY_SHA" ] || fail "runner entry sha256 does not match the pin"
sha256sum "$RUNNER_PKG"/requirements/*.yaml

cd "$CONSUMER" && npm install --ignore-scripts --prefer-offline --no-fund --no-audit \
  "file:../samedaydesk-capability-compat/${PACK_TGZ}" \
  "file:../samedaydesk-interop-corpus/${CORPUS_TGZ}" || fail "consumer install failed"

cd "$ROOT"
export PAGE_CHANGE_HTTP_ENABLED=1
node --test --test-concurrency=1 \
  packs/samedaydesk-interop-corpus/test/corpus-schema.test.mjs \
  packs/samedaydesk-interop-corpus/test/classify.test.mjs \
  packs/samedaydesk-interop-corpus/test/adapter.test.mjs \
  packs/samedaydesk-interop-corpus/test/replay.test.mjs \
  packs/samedaydesk-capability-compat-consumer/test/page-change-compat.test.mjs \
  packs/samedaydesk-capability-compat-consumer/test/interop-corpus.test.mjs
TESTS_EXIT=$?
echo "TESTS_EXIT=${TESTS_EXIT}"

mkdir -p "$OUT"; echo "output dir ${OUT}"
node "$CONSUMER/test-only/serve-loopback.mjs" > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
ENDPOINT=""
for _ in $(seq 1 50); do
  ENDPOINT="$(awk '/^LISTENING /{print $2; exit}' "$OUT/server.log")"
  [ -n "$ENDPOINT" ] && break
  sleep 0.2
done
[ -n "$ENDPOINT" ] || { kill "$SERVER_PID" 2>/dev/null; fail "loopback page-change did not start"; }
echo "loopback endpoint ${ENDPOINT}"

node "$CORPUS/bin/interop-corpus.mjs" conformance \
  --url "$ENDPOINT" --out "$OUT/runner" --report "$OUT/report.json" > /dev/null
CONFORMANCE_EXIT=$?
kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null

node -e '
const r = require(process.argv[1]);
console.log("report scope", r.scope, "universalConformance", r.universalConformance);
console.log("runner", r.runner.package, r.runner.version, r.runner.gitHead);
console.log("totals", JSON.stringify(r.totals), "blocking", r.blocking);
for (const rev of r.revisions) {
  const by = {};
  for (const s of rev.scenarios) by[s.outcomeClass] = (by[s.outcomeClass] || 0) + 1;
  console.log("revision", rev.revision, "served", rev.served, "runnerExit", rev.runnerExitCode, JSON.stringify(by));
  for (const s of rev.scenarios.filter((s) => ["harness_failure", "unexplained_failure"].includes(s.outcomeClass))) {
    console.log("  ", s.outcomeClass, s.scenario, JSON.stringify(s.checks.filter((c) => c.blocking || c.outcomeClass === "unexplained_failure").map((c) => [c.checkId, c.reason])));
  }
}
' "$OUT/report.json" || echo "report unreadable"
echo "report sha256 $(sha256sum "$OUT/report.json" | awk '{print $1}')"
echo "CONFORMANCE_EXIT=${CONFORMANCE_EXIT}"
echo "tgz sha256 ${PACK_SHA}  ${PACK_TGZ}"
echo "tgz sha256 ${CORPUS_SHA}  ${CORPUS_TGZ}"

if [ "$TESTS_EXIT" -ne 0 ]; then exit "$TESTS_EXIT"; fi
exit "$CONFORMANCE_EXIT"
