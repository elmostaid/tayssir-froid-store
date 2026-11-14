#!/usr/bin/env bash
# نسخة الإنتاج داخل آلة Vercel Sandbox المعزولة، ثم استرجاعها محلياً للتحقّق.
# الاتصال: دور قراءة مؤقّت (tf_backup_reader)، كلمة سرّه في /root/.tf/pw فقط،
# تُحذف في نهاية التشغيل نجح أم فشل. لا شيء يُكتب في الإنتاج.
# المتغيّرات: PGHOST PGPORT PGUSER PGDATABASE (بلا كلمة السرّ).
set -euo pipefail
OUT=/root/tf-backups; mkdir -p "$OUT"; chmod 700 "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; FILE="$OUT/tayssir-prod-$STAMP.dump"
trap 'rm -f /root/.tf/pw' EXIT
export PGPASSWORD="$(cat /root/.tf/pw)" PGSSLMODE="${PGSSLMODE:-require}" PGCONNECT_TIMEOUT=20 PGAPPNAME=tf-backup
COUNT_SQL="select string_agg(t||' '||n, E'\n' order by t) from (select 'public.'||table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' union all select 'auth.users', (select count(*) from auth.users)::text) s(t, n)"
ro() { psql -X -q -tA -v ON_ERROR_STOP=1 -c "begin transaction read only" -c "$1" -c "commit"; }

echo "server: $(ro 'show server_version')"
ro "$COUNT_SQL" > "$OUT/before-$STAMP.txt"
pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth --file="$FILE"
ro "$COUNT_SQL" > "$OUT/after-$STAMP.txt"
unset PGPASSWORD; rm -f /root/.tf/pw
chmod 600 "$FILE"

# استرجاع في Postgres محلي داخل الآلة، في قاعدة جديدة فارغة.
unset PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE
V="verify_${STAMP,,}"
su postgres -c "psql -X -q -c 'create database $V'"
for r in anon authenticated service_role supabase_admin supabase_auth_admin; do su postgres -c "psql -X -q -c 'create role $r nologin'" >/dev/null 2>&1 || true; done
# الملف لـroot وحده (600): يُمرَّر عبر stdin بدل منح postgres حقّ قراءته.
su postgres -c "pg_restore --no-owner --no-privileges -d $V" < "$FILE" 2> "$OUT/restore-$STAMP.log" || true
su postgres -c "psql -X -q -tA -d $V -c \"$COUNT_SQL\"" > "$OUT/restored-$STAMP.txt" 2>>"$OUT/restore-$STAMP.log" || true

ok=1
while read -r t b; do
  a="$(awk -v t="$t" '$1==t{print $2}' "$OUT/after-$STAMP.txt")"
  r="$(awk -v t="$t" '$1==t{print $2}' "$OUT/restored-$STAMP.txt")"
  if [[ -n "$r" ]] && (( r >= b && r <= ${a:-$b} )); then echo "OK   $t $r"; else echo "FAIL $t restored=${r:-missing} before=$b after=$a"; ok=0; fi
done < "$OUT/before-$STAMP.txt"
echo "restore_errors: $(grep -c 'error:' "$OUT/restore-$STAMP.log" || true)"
grep 'error:' "$OUT/restore-$STAMP.log" | sed -E 's/(ERROR: +[^\"]*).*/\1/' | sort | uniq -c | head -10
sha256sum "$FILE" | tee "$FILE.sha256"
echo "size: $(du -h "$FILE" | cut -f1)"
(( ok == 1 )) && echo "RESULT: VERIFIED" || { echo "RESULT: NOT VERIFIED"; exit 1; }
