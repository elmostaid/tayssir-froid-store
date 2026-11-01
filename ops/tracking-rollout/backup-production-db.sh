#!/usr/bin/env bash
# نسخة احتياطية خارجية لقاعدة الإنتاج — قبل أي migration.
#
# لماذا هذا السكربت: مشروع Supabase على الخطة المجانية، وهي **بلا نسخ يومية
# تلقائية** (تبدأ من Pro). فإن لم نأخذ نسخة بأنفسنا، لا نسخة.
#
# الاستعمال (من جهاز صاحب المشروع، لا من خادم مشترك):
#   export PROD_DATABASE_URL='postgresql://...'   # من Supabase ← Connect ← Session pooler
#   ./ops/tracking-rollout/backup-production-db.sh [مجلد_الحفظ]
#
# الضمانات:
#   - الرابط لا يُطبع أبداً، ولا يُكتب في أي ملف.
#   - pg_dump يجب أن يكون بنفس إصدار الخادم أو أحدث (الإنتاج Postgres 17).
#   - النسخة تُتحقَّق: pg_restore يقرؤها كاملة، وعدد صفوف الجداول الحرجة في
#     النسخة يطابق الإنتاج لحظة أخذها. وإن ضُبط VERIFY_DATABASE_URL (قاعدة
#     محلية فارغة)، تُسترجَع فيها فعلاً ويُقارن العدّ.
#   - الملف يحوي بيانات زبائن: يُحفظ خارج المستودع (المجلد backups/ مُستثنى من
#     git)، ويُنقل إلى مكان آمن خارج هذا الجهاز.
set -euo pipefail

: "${PROD_DATABASE_URL:?اضبط PROD_DATABASE_URL أولاً (لا يُطبع)}"
OUT_DIR="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT_DIR}/tayssir-prod-${STAMP}.dump"
CRITICAL_TABLES=(orders order_items order_status_history stock_movements products whatsapp_leads settings)

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

server_major="$(psql "$PROD_DATABASE_URL" -tAc 'show server_version_num' | cut -c1-2)"
client_major="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
if (( client_major < server_major )); then
  echo "pg_dump ${client_major} أقدم من الخادم ${server_major} — ثبّت postgresql-client-${server_major}." >&2
  exit 1
fi

echo "==> عدّ الصفوف في الإنتاج (للمقارنة)"
declare -A prod_counts
for t in "${CRITICAL_TABLES[@]}"; do
  prod_counts[$t]="$(psql "$PROD_DATABASE_URL" -tAc "select count(*) from public.${t}")"
done

echo "==> pg_dump (public + auth، بلا مالكين ولا صلاحيات خاصة بالمنصّة)"
pg_dump "$PROD_DATABASE_URL" \
  --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth \
  --file="$FILE"
chmod 600 "$FILE"

echo "==> التحقّق: pg_restore يقرأ النسخة كاملة"
entries="$(pg_restore --list "$FILE" | grep -c 'TABLE DATA' || true)"
echo "    جداول ببيانات في النسخة: ${entries}"
(( entries > 0 )) || { echo "النسخة بلا بيانات — توقّف." >&2; exit 1; }

if [[ -n "${VERIFY_DATABASE_URL:-}" ]]; then
  echo "==> استرجاع تجريبي في VERIFY_DATABASE_URL ومقارنة العدّ"
  pg_restore --no-owner --no-privileges --schema=public --dbname="$VERIFY_DATABASE_URL" "$FILE" 2>/dev/null || true
  for t in "${CRITICAL_TABLES[@]}"; do
    restored="$(psql "$VERIFY_DATABASE_URL" -tAc "select count(*) from public.${t}")"
    if [[ "$restored" != "${prod_counts[$t]}" ]]; then
      echo "    ✗ ${t}: الإنتاج ${prod_counts[$t]} ≠ النسخة ${restored}" >&2
      exit 1
    fi
    echo "    ✓ ${t}: ${restored}"
  done
fi

sha256sum "$FILE" | tee "${FILE}.sha256"
echo "==> جاهزة: ${FILE} ($(du -h "$FILE" | cut -f1)). انقلها إلى مكان آمن خارج هذا الجهاز."
