#!/usr/bin/env bash
# قاعدة محلية معزولة لسيناريوهات صلابة الاتصال — لا علاقة لها بالإنتاج
# ولا بالمعاينة، ولا تحتوي أي بيانات زبناء.
set -euo pipefail
PORT="${RESILIENCE_PG_PORT:-5433}"
PSQL="psql postgres://postgres@127.0.0.1:${PORT}/postgres"
$PSQL -tc "select 1 from pg_database where datname='tayssir_resilience'" | grep -q 1 \
  || $PSQL -c "create database tayssir_resilience"
psql "postgres://postgres@127.0.0.1:${PORT}/tayssir_resilience" \
  -c "create table if not exists public.probe_writes (
        id bigserial primary key,
        tag text not null unique,
        at timestamptz not null default clock_timestamp())" \
  -c "truncate public.probe_writes"
echo "جاهزة: tayssir_resilience على المنفذ ${PORT}"
