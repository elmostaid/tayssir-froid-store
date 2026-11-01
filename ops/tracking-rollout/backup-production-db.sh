#!/usr/bin/env bash
# نسخة احتياطية خارجية لقاعدة الإنتاج — قبل أي migration.
#
# لماذا هذا السكربت: مشروع Supabase على الخطة المجانية، وهي **بلا نسخ يومية
# تلقائية** (تبدأ من Pro). فإن لم نأخذ نسخة بأنفسنا، لا نسخة.
#
# الاستعمال (من جهاز صاحب المشروع، لا من خادم مشترك):
#   ./ops/tracking-rollout/backup-production-db.sh [مجلد_الحفظ]
# يطلب رابط الاتصال **مخفياً** (لا يظهر على الشاشة ولا في تاريخ الأوامر).
# الرابط من Supabase ← Project ← Connect ← Session pooler، بكلمة سرّ القاعدة.
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

if [[ -z "${PROD_DATABASE_URL:-}" ]]; then
  # `read -s`: لا صدى على الشاشة، ولا يدخل history لأنه ليس جزءاً من الأمر.
  read -rsp "رابط قاعدة الإنتاج (مخفي): " PROD_DATABASE_URL
  echo
fi
[[ -n "$PROD_DATABASE_URL" ]] || { echo "لا رابط — توقّف." >&2; exit 1; }
export PGCONNECT_TIMEOUT=15
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

# التحقّق بالاسترجاع: قاعدة محلية فارغة إن أُعطيت، وإلا حاوية Postgres مؤقتة
# بنفس إصدار الإنتاج إن وُجد Docker — تُحذف بعد المقارنة.
TEMP_CONTAINER=""
cleanup() { [[ -n "$TEMP_CONTAINER" ]] && docker rm -f "$TEMP_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [[ -z "${VERIFY_DATABASE_URL:-}" ]] && command -v docker >/dev/null 2>&1; then
  echo "==> حاوية Postgres ${server_major} مؤقتة للتحقّق بالاسترجاع"
  TEMP_CONTAINER="tf-backup-verify-$$"
  docker run -d --rm --name "$TEMP_CONTAINER" -e POSTGRES_PASSWORD=verify -p 127.0.0.1::5432 "postgres:${server_major}" >/dev/null
  port="$(docker port "$TEMP_CONTAINER" 5432/tcp | head -1 | sed 's/.*://')"
  for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$port" >/dev/null 2>&1 && break; sleep 1; done
  # أدوار Supabase التي تشير إليها الصلاحيات — بلا تسجيل دخول، للاسترجاع فقط.
  for role in anon authenticated service_role supabase_admin supabase_auth_admin; do
    psql "postgresql://postgres:verify@127.0.0.1:${port}/postgres" -qc "create role ${role} nologin" >/dev/null 2>&1 || true
  done
  psql "postgresql://postgres:verify@127.0.0.1:${port}/postgres" -qc "create schema if not exists auth" >/dev/null
  VERIFY_DATABASE_URL="postgresql://postgres:verify@127.0.0.1:${port}/postgres"
fi

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

if [[ -z "${VERIFY_DATABASE_URL:-}" ]]; then
  echo "⚠ لا Docker ولا VERIFY_DATABASE_URL: النسخة مقروءة لكن الاسترجاع لم يُجرَّب." >&2
fi

(command -v sha256sum >/dev/null && sha256sum "$FILE" || shasum -a 256 "$FILE") | tee "${FILE}.sha256"
echo "==> جاهزة: ${FILE} ($(du -h "$FILE" | cut -f1)). انقلها إلى مكان آمن خارج هذا الجهاز."
