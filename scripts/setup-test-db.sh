#!/usr/bin/env bash
# يُنشئ قاعدة اختبار محلية مطابقة لمخطَّط الإنتاج، انطلاقاً من ملفات
# supabase/migrations نفسها (وليس من نسخة مخطَّط مكتوبة يدوياً قد تنحرف).
#
# اختبارات التكامل في هذا المشروع (createOrder, adminCustomers, adminReports…)
# تكتب فعلياً على قاعدة Postgres حقيقية — هذا مقصود: هي تتحقق من سلوك
# المعاملات والأقفال وقيود القاعدة، وهو ما لا تلتقطه أي محاكاة (mock). بدون
# قاعدة محلية كانت 24 منها تفشل عند التحميل بخطأ "DATABASE_URL غير معرَّف".
#
# الاستعمال:
#   ./scripts/setup-test-db.sh                 # ينشئ ويهيّئ القاعدة
#   eval "$(./scripts/setup-test-db.sh --env)" # يطبع سطر DATABASE_URL فقط
#
# لا علاقة لهذا الملف بقاعدة الإنتاج إطلاقاً — لا يقرأ منها ولا يكتب عليها.
set -euo pipefail

PGPORT="${TEST_PGPORT:-5433}"
PGHOST="${TEST_PGHOST:-127.0.0.1}"
PGUSER="${TEST_PGUSER:-postgres}"
DBNAME="${TEST_PGDATABASE:-tayssir_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="postgres://${PGUSER}@${PGHOST}:${PGPORT}/${DBNAME}"

if [ "${1:-}" = "--env" ]; then
  echo "export DATABASE_URL='${URL}'"
  exit 0
fi

echo "==> إعادة إنشاء قاعدة الاختبار ${DBNAME} على ${PGHOST}:${PGPORT}"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists ${DBNAME};" -c "create database ${DBNAME};"

echo "==> أدوار وschema auth المُحاكية (كما توفّرها Supabase تلقائياً)"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DBNAME" -v ON_ERROR_STOP=1 -q \
  -f "$ROOT/db/local-dev/00_bootstrap_supabase_like_roles.sql"

echo "==> تطبيق supabase/migrations بالترتيب"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DBNAME" -v ON_ERROR_STOP=1 -q -f "$f" \
    || { echo "فشل عند: $(basename "$f")" >&2; exit 1; }
done

echo "==> جاهزة: ${URL}"
