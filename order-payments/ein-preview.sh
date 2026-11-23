#!/usr/bin/env bash
set -euo pipefail
: "${EIN_PREVIEW_SOURCE:?set the EIN source path}" "${EIN_FIREBASE_BIN:?set the Firebase emulator executable}"
export EIN_PREVIEW_SOURCE="$(cd "$EIN_PREVIEW_SOURCE" && pwd)"
export EIN_TEST_FILE="$(cd "$(dirname "$0")" && pwd)/ein-preview.test.mjs"
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cp "$EIN_PREVIEW_SOURCE/firestore.rules" "$dir/firestore.rules"
cat > "$dir/firebase.json" <<'CONFIG'
{"firestore":{"rules":"firestore.rules"},"emulators":{"auth":{"host":"127.0.0.1","port":59393},"firestore":{"host":"127.0.0.1","port":58393},"ui":{"enabled":false},"hub":{"host":"127.0.0.1","port":44393},"logging":{"host":"127.0.0.1","port":45393},"singleProjectMode":true}}
CONFIG
cd "$EIN_PREVIEW_SOURCE"
npm --prefix artifacts/api-server run build
cd "$dir"
export JAVA_TOOL_OPTIONS="-Xmx512m"
"$EIN_FIREBASE_BIN" emulators:exec --only auth,firestore --project demo-ein-order-rail --config "$dir/firebase.json" 'node --test "$EIN_TEST_FILE"'
