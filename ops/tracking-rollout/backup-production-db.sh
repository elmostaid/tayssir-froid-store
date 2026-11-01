#!/usr/bin/env bash
# نسخة احتياطية خارجية لقاعدة الإنتاج — قبل أي migration.
#
# الخطة المجانية في Supabase بلا نسخ يومية تلقائية: إن لم نأخذها بأنفسنا، لا نسخة.
#
# الاستعمال (من جهاز صاحب المشروع):
#   bash ops/tracking-rollout/backup-production-db.sh [مجلد_الحفظ]     (الافتراضي: ~/tf-backups)
# يطلب رابط Session pooler **مخفياً**. إن كان الرابط يحوي [YOUR-PASSWORD] كما
# نسخته من Supabase، يطلب كلمة السرّ وحدها مخفيةً أيضاً.
#
# ضمانات السلامة:
#   - الإنتاج: قراءة فقط. كل استعلام داخل `begin transaction read only`، وpg_dump
#     يقرأ فقط بطبيعته. لا شيء يُكتب في الإنتاج.
#   - الرابط وكلمة السرّ لا يُطبعان، ولا يُكتبان في ملف، ولا يظهران في قائمة
#     العمليات (يُمرَّران عبر متغيّرات بيئة libpq، لا كوسائط أوامر).
#   - الاسترجاع التجريبي لا يكون إلا في قاعدة **محلية** (localhost) و**فارغة** —
#     يرفض السكربت غير ذلك، فلا يمكن أن يُسترجع فوق الإنتاج خطأً.
#   - يعمل على bash 3.2 (macOS) وما فوق، وGit Bash على Windows.
#
# التحقّق: عدد صفوف **كل** جداول public (+auth.users) في النسخة المسترجَعة يقع
# بين العدّ قبل النسخ وبعده (طلبية تصل أثناء النسخ لا تُحسب عطلاً).
set -euo pipefail

say()  { printf '%s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

# ---------- 1. الأدوات ----------
# Homebrew يثبّت libpq/postgresql@17 خارج PATH، وWindows في Program Files.
for d in /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin \
         /opt/homebrew/opt/postgresql@18/bin /usr/local/opt/postgresql@18/bin \
         /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin \
         "/c/Program Files/PostgreSQL/18/bin" "/c/Program Files/PostgreSQL/17/bin"; do
  [[ -x "$d/pg_dump" || -x "$d/pg_dump.exe" ]] && PATH="$d:$PATH"
done
for tool in psql pg_dump pg_restore; do
  command -v "$tool" >/dev/null 2>&1 || fail "الأداة ${tool} غير موجودة — ثبّت PostgreSQL 17 (أدوات العميل)."
done
client_major="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"

# قاعدة التحقّق: محلية وفارغة، وإلا رفض — يُفحص قبل النسخ وبعده.
verify_guard() {
  case "$VERIFY_DATABASE_URL" in
    *@localhost[:/]*|*@127.0.0.1[:/]*|*@\[::1\][:/]*) ;;
    *) fail "VERIFY_DATABASE_URL يجب أن يكون قاعدة محلية (localhost) — رفض للسلامة." ;;
  esac
  local existing
  existing="$(PGSSLMODE=prefer psql -X -q -tA "$VERIFY_DATABASE_URL" -c "select count(*) from pg_tables where schemaname in ('public','auth')")" \
    || fail "تعذّر الاتصال بقاعدة التحقّق المحلية."
  [[ "$existing" == "0" ]] || fail "قاعدة التحقّق ليست فارغة (${existing} جدولاً) — رفض للسلامة."
}
[[ -n "${VERIFY_DATABASE_URL:-}" ]] && verify_guard

# ---------- 2. الاتصال (مخفي) ----------
if [[ -z "${PROD_DATABASE_URL:-}" ]]; then
  read -rsp "الصق رابط قاعدة الإنتاج (Session pooler) ثم Enter — لن يظهر: " PROD_DATABASE_URL
  echo
fi
url="$PROD_DATABASE_URL"
unset PROD_DATABASE_URL
[[ -n "$url" ]] || fail "لا رابط."
re='^postgres(ql)?://([^:/@]+):(.*)@([^@/:?]+):([0-9]+)/([^?]+)(\?.*)?$'
[[ "$url" =~ $re ]] || fail "صيغة الرابط غير متوقَّعة (المنتظر postgresql://USER:PASSWORD@HOST:PORT/postgres)."
PGUSER="${BASH_REMATCH[2]}"; pw="${BASH_REMATCH[3]}"; PGHOST="${BASH_REMATCH[4]}"
PGPORT="${BASH_REMATCH[5]}"; PGDATABASE="${BASH_REMATCH[6]}"
url=""
if [[ "$pw" == "[YOUR-PASSWORD]" || -z "$pw" ]]; then
  read -rsp "كلمة سرّ القاعدة — لن تظهر: " pw
  echo
elif [[ "$pw" =~ %[0-9A-Fa-f]{2} ]]; then
  pw="$(printf '%b' "${pw//%/\\x}")"   # كلمة سرّ مُرمَّزة داخل الرابط
fi
[[ -n "$pw" ]] || fail "لا كلمة سرّ."
PGPASSWORD="$pw"; pw=""
export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE
export PGSSLMODE="${PGSSLMODE:-require}" PGCONNECT_TIMEOUT=15 PGAPPNAME=tf-backup
case "$PGHOST" in localhost|127.0.0.1|::1) fail "الرابط يشير إلى جهازك، لا إلى الإنتاج." ;; esac

prod_ro() { psql -X -q -tA -v ON_ERROR_STOP=1 -c "begin transaction read only" -c "$1" -c "commit"; }
COUNT_SQL="select 'public.'||table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' union all select 'auth.users', (select count(*) from auth.users)::text order by 1"
COUNT_SQL="select string_agg(t||' '||n, E'\n') from (${COUNT_SQL}) s(t, n)"

say "==> الاتصال بالإنتاج (قراءة فقط)…"
server_num="$(prod_ro 'select current_setting($$server_version_num$$)')" || fail "تعذّر الاتصال. تحقّق من الرابط وكلمة السرّ واتصال الإنترنت."
server_major="$((10#${server_num:0:2}))"
say "    متصل: Postgres ${server_major}، أدواتك ${client_major}."
(( client_major >= server_major )) || fail "pg_dump ${client_major} أقدم من الخادم ${server_major} — ثبّت أدوات PostgreSQL ${server_major}."

# ---------- 3. المجلد ----------
OUT_DIR="${1:-$HOME/tf-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT_DIR}/tayssir-prod-${STAMP}.dump"
WORK="$(mktemp -d)"
TEMP_CONTAINER=""
cleanup() {
  [[ -n "$TEMP_CONTAINER" ]] && docker rm -f "$TEMP_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$OUT_DIR"; chmod 700 "$OUT_DIR" 2>/dev/null || true

# ---------- 4. العدّ قبل، النسخ، العدّ بعد ----------
say "==> عدّ الصفوف قبل النسخ"
prod_ro "$COUNT_SQL" > "$WORK/before"
say "==> pg_dump (public + auth)… (دقيقة أو أقل لقاعدة 37 MB)"
pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth --file="$FILE"
chmod 600 "$FILE" 2>/dev/null || true
say "==> عدّ الصفوف بعد النسخ"
prod_ro "$COUNT_SQL" > "$WORK/after"
unset PGPASSWORD   # انتهى العمل مع الإنتاج

entries="$(pg_restore --list "$FILE" | grep -c 'TABLE DATA' || true)"
(( entries > 0 )) || fail "النسخة بلا بيانات."
say "    النسخة مقروءة: ${entries} جدولاً ببيانات."

# ---------- 5. الاسترجاع التجريبي ----------
unset PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE
if [[ -z "${VERIFY_DATABASE_URL:-}" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  say "==> تشغيل Postgres ${server_major} مؤقّت في Docker (يُحذف في النهاية)…"
  TEMP_CONTAINER="tf-backup-verify-$$"
  docker run -d --rm --name "$TEMP_CONTAINER" -e POSTGRES_PASSWORD=verify -p 127.0.0.1::5432 "postgres:${server_major}" >/dev/null
  port="$(docker port "$TEMP_CONTAINER" 5432/tcp | head -1 | sed 's/.*://')"
  VERIFY_DATABASE_URL="postgresql://postgres:verify@127.0.0.1:${port}/postgres"
  for _ in $(seq 1 60); do
    psql -X -q -tA "$VERIFY_DATABASE_URL" -c 'select 1' >/dev/null 2>&1 && break; sleep 1
  done
fi

if [[ -z "${VERIFY_DATABASE_URL:-}" ]]; then
  sha="$( (command -v sha256sum >/dev/null && sha256sum "$FILE" || shasum -a 256 "$FILE") | tee "${FILE}.sha256")"
  say "⚠ لا Docker ولا VERIFY_DATABASE_URL: النسخة أُخذت ومقروءة، لكن الاسترجاع **لم يُجرَّب**."
  say "   لا تعتبرها نسخة مُتحقَّقاً منها. شغّل Docker Desktop وأعد المحاولة."
  exit 2
fi

verify_guard

say "==> الاسترجاع في القاعدة المحلية…"
# أدوار Supabase التي تشير إليها السياسات — بلا دخول، للاسترجاع فقط.
for role in anon authenticated service_role supabase_admin supabase_auth_admin; do
  psql -X -q "$VERIFY_DATABASE_URL" -c "create role ${role} nologin" >/dev/null 2>&1 || true
done
pg_restore --no-owner --no-privileges --dbname="$VERIFY_DATABASE_URL" "$FILE" 2>"$WORK/restore.log" || true
restore_errors="$(grep -c 'error:' "$WORK/restore.log" || true)"
psql -X -q -tA "$VERIFY_DATABASE_URL" -c "$COUNT_SQL" > "$WORK/restored"

say "==> المقارنة (قبل ≤ النسخة ≤ بعد)"
ok=1
while read -r t n_before; do
  [[ -n "$t" ]] || continue
  n_after="$(awk -v t="$t" '$1==t{print $2}' "$WORK/after")"
  n_rest="$(awk -v t="$t" '$1==t{print $2}' "$WORK/restored")"
  if [[ -z "$n_rest" ]]; then
    say "    ✗ ${t}: غير موجود في النسخة المسترجَعة"; ok=0
  elif (( n_rest >= n_before && n_rest <= ${n_after:-$n_before} )); then
    say "    ✓ ${t}: ${n_rest}"
  else
    say "    ✗ ${t}: النسخة ${n_rest} خارج [${n_before}، ${n_after}]"; ok=0
  fi
done < "$WORK/before"

# أخطاء الاسترجاع المتوقَّعة: كائنات خاصة بمنصّة Supabase (امتدادات، مخطّطات
# أخرى). تُعرض للعلم؛ الحَكَم هو مطابقة الأعداد أعلاه.
if (( restore_errors > 0 )); then
  say "    ملاحظة: ${restore_errors} تحذير استرجاع لكائنات خاصة بـSupabase (لا تمسّ البيانات)."
fi
(( ok == 1 )) || fail "النسخة لا تطابق الإنتاج — لا تعتمد عليها، وأخبرني بالسطور ✗ أعلاه."

sha="$( (command -v sha256sum >/dev/null && sha256sum "$FILE" || shasum -a 256 "$FILE") | tee "${FILE}.sha256")"
say ""
say "✅ نسخة مُتحقَّق منها بالاسترجاع."
say "   الملف: ${FILE} ($(du -h "$FILE" | cut -f1))"
say "   sha256: ${sha%% *}"
say "   أرسل لي هذه السطور فقط (لا الرابط ولا الملف)، ثم انسخ الملف و.sha256 إلى مكان ثانٍ خارج الجهاز."
