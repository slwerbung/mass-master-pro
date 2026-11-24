#!/usr/bin/env bash
# Integrationstest Sync v2 gegen ein lokales Postgres (>= 14).
# Aufruf: SYNC_PG_URL=postgres://user@host:port/db scripts/test-sync-integration.sh
#   (die Datenbank wird dabei geleert – NIE gegen Produktion laufen lassen!)
set -euo pipefail
: "${SYNC_PG_URL:?SYNC_PG_URL setzen (lokale Test-DB)}"
cd "$(dirname "$0")/.."
# SQL-Tests der Migration
psql "$SYNC_PG_URL" -q -v ON_ERROR_STOP=1 -c "drop schema if exists public cascade; create schema public; drop schema if exists storage cascade; drop publication if exists supabase_realtime;" >/dev/null
psql "$SYNC_PG_URL" -q -v ON_ERROR_STOP=1 \
  -f supabase/tests/sync_v2_stub_schema.sql \
  -f supabase/migrations/20261124120000_sync_v2.sql \
  -f supabase/tests/sync_v2_test.sql 2>&1 | grep -E "FAIL|ERROR|ok:" | sed 's/^.*NOTICE: *//'
# Engine mit zwei Geraeten
SYNC_PG_URL="$SYNC_PG_URL" npx vitest run src/lib/sync/
