#!/usr/bin/env bash
set -euo pipefail
: "${NEO_REPORT_PREVIEW_SOURCE:?set the Neomorphic source path}"
: "${SDS_PREVIEW_SOURCE:?set the SameDayDesk source path}"
export NEO_REPORT_PREVIEW_SOURCE="$(cd "$NEO_REPORT_PREVIEW_SOURCE" && pwd)"
export SDS_PREVIEW_SOURCE="$(cd "$SDS_PREVIEW_SOURCE" && pwd)"
gateway="$(cd "$(dirname "$0")/.." && pwd)"
dir="$(mktemp -d)"
bin="$(pg_config --bindir)"
"$bin/initdb" -A trust -D "$dir/data" >/dev/null
"$bin/pg_ctl" -D "$dir/data" -l "$dir/log" -o "-F -p 55414 -k $dir -c listen_addresses=''" -w start >/dev/null
trap '"$bin/pg_ctl" -D "$dir/data" -m immediate -w stop >/dev/null; rm -rf "$dir"' EXIT
"$bin/createdb" -h "$dir" -p 55414 house_test
export HOUSE_TEST_PG_SOCKET="$dir" HOUSE_TEST_PG_PORT=55414
cd "$NEO_REPORT_PREVIEW_SOURCE/services/house"
node --test test/postgres/report-order-rail.test.mjs test/postgres/report-payments.test.mjs test/postgres/desk-payments.test.mjs
cd "$gateway"
node --test order-payments/report-preview.test.mjs order-payments/neo-preview.test.mjs
