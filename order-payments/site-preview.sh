#!/usr/bin/env bash
# From gateway checkout, with SDS_PREVIEW_SOURCE set to the isolated SDS checkout.
set -euo pipefail
: "${SDS_PREVIEW_SOURCE:?set SDS_PREVIEW_SOURCE to the qualified SDS checkout}"
sds_source="$(cd "$SDS_PREVIEW_SOURCE" && pwd)"
gateway_source="$(cd "$(dirname "$0")/.." && pwd)"
export SDS_PREVIEW_SOURCE="$sds_source"
cd "$sds_source"
export PREVIEW_RELEASE_KIT
PREVIEW_RELEASE_KIT="$(node scripts/release/kit.mjs path | tail -1)"
pg_bin="$(pg_config --bindir)"
pg_dir="$(mktemp -d)"
"$pg_bin/initdb" -A trust -D "$pg_dir/data" >/dev/null
"$pg_bin/pg_ctl" -D "$pg_dir/data" -l "$pg_dir/log" -o "-F -p 55401 -k $pg_dir -c listen_addresses=''" -w start >/dev/null
trap '"$pg_bin/pg_ctl" -D "$pg_dir/data" -m immediate -w stop >/dev/null; rm -rf "$pg_dir"' EXIT
dsn="postgresql://$(id -un)@127.0.0.1/postgres?host=$pg_dir&port=55401"
node server/scripts/care-enrollment.mjs sds_care_fixture sds_care_fixture_app | psql -X -q -v ON_ERROR_STOP=1 "$dsn"
export SDS_PRIVATE_PREVIEW=1 SDS_CARE_SCHEMA=sds_care_fixture
export SDS_CARE_DATABASE_URL="postgresql://sds_care_fixture_app@127.0.0.1/postgres?host=$pg_dir&port=55401"
cd "$gateway_source"
npm run build
node --test order-payments/site-preview.test.mjs
