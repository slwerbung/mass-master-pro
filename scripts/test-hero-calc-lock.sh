#!/usr/bin/env bash
# Test der hero-calc-Sperre (Migration 20261126120000) gegen ein lokales Postgres (>= 14).
# Aufruf: HERO_CALC_PG_URL=postgres://user@host:port/db scripts/test-hero-calc-lock.sh
#   (die Datenbank wird dabei geleert – NIE gegen Produktion laufen lassen!)
set -euo pipefail
: "${HERO_CALC_PG_URL:?HERO_CALC_PG_URL setzen (lokale Test-DB)}"
cd "$(dirname "$0")/.."
q() { psql "$HERO_CALC_PG_URL" -qAt -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FAIL: $1"; exit 1; }
q -c "drop schema if exists public cascade; create schema public;" >/dev/null
q -f supabase/tests/hero_calc_stub_schema.sql \
  -f supabase/migrations/20261125120000_hero_calc_undo.sql \
  -f supabase/migrations/20261126120000_hero_calc_lock_and_hash.sql >/dev/null
# Migration ist wiederholbar
q -f supabase/migrations/20261126120000_hero_calc_lock_and_hash.sql >/dev/null || fail "Migration nicht idempotent"
[ "$(q -c "select public.hero_calc_acquire_lock(1, 30)")" = "t" ] || fail "erste Sperre"
[ "$(q -c "select public.hero_calc_acquire_lock(1, 30)")" = "f" ] || fail "zweite Sperre muss scheitern"
[ "$(q -c "select public.hero_calc_acquire_lock(2, 30)")" = "t" ] || fail "andere Dokumente sind unabhängig"
q -c "select public.hero_calc_release_lock(1)" >/dev/null
[ "$(q -c "select public.hero_calc_acquire_lock(1, 30)")" = "t" ] || fail "nach Freigabe wieder möglich"
q -c "update public.hero_calc_lock set locked_until = now() - interval '1 second' where document_id = 1" >/dev/null
[ "$(q -c "select public.hero_calc_acquire_lock(1, 30)")" = "t" ] || fail "abgelaufene Sperre muss verfallen"
# Rechte: anon/authenticated dürfen weder Funktion noch Tabellen nutzen, service_role die Funktion
for r in anon authenticated; do
  q -c "set role $r; select public.hero_calc_acquire_lock(9, 30)" >/dev/null 2>&1 && fail "$r darf die Sperre nicht nutzen"
  q -c "set role $r; select * from public.hero_calc_lock" >/dev/null 2>&1 && fail "$r darf hero_calc_lock nicht lesen"
  q -c "set role $r; select * from public.hero_calc_undo" >/dev/null 2>&1 && fail "$r darf hero_calc_undo nicht lesen"
done
[ "$(q -c "set role service_role; select public.hero_calc_acquire_lock(9, 30)" | tail -1)" = "t" ] || fail "service_role muss die Sperre nutzen dürfen"
# Echt parallel: 8 gleichzeitige Aufrufe auf dasselbe Dokument, genau einer gewinnt
q -c "create table public._race(r boolean)" >/dev/null
q -c "delete from public.hero_calc_lock where document_id = 101" >/dev/null
for i in $(seq 1 8); do
  ( q -c "insert into public._race select public.hero_calc_acquire_lock(101, 30)" ) &
done
wait
[ "$(q -c "select count(*) filter (where r) from public._race")" = "1" ] || fail "genau ein paralleler Aufruf darf die Sperre bekommen"
[ "$(q -c "select count(*) from public._race")" = "8" ] || fail "nicht alle Aufrufe liefen"
echo "ok: hero_calc lock (Migration, Rechte, Verfall, 8 parallele Aufrufe -> genau 1 Gewinner)"
