# استرجاع النسخة الاحتياطية المشفّرة

## أين هي
- **الملف المشفّر:** Supabase ← مشروع `tayssir-froid-preview` ← Storage ← حاوية
  خاصة `prod-backups` ← مجلد `0b634a97a98a046b04583c02/` ←
  `tayssir-prod-20261101T171349Z.dump.enc` (2.0 MB). لا رابط عام (يُرفض بـ400).
- **المفتاح:** ملف `tayssir-backup-private-key.pem` عند صاحب المشروع وحده (لا
  في المستودع، لا في Supabase، لا في Vercel). بلا المفتاح النسخة غير مقروءة.
- **الشهادة العامة** (للتشفير فقط، لا تفكّ شيئاً): في آلة Vercel `/root/tf/backup-public-cert.pem`
  (ملفات `.pem` مستثناة من git عمداً). بصمتها SHA-256 تبدأ بـ `32:7D:D3:88:19:42:BC:E7`.

## البصمات (للتحقّق)
| | sha256 |
|---|---|
| النسخة بعد فكّ التشفير (pg_dump custom) | `4ef643e8fdbb6eafae7c273f3d3d9b1fc0343884f226315a3f6388927f716fb2` |
| الملف المشفّر كما هو مخزَّن | `e3f6b7a7baaff04a4f1dbedc30a799f822b0d9b67ac0ec41749d386e7a8d80ce` |

## ما تحتويه (أخذت 2026-11-01 17:13 UTC، Postgres 17.6)
مخطّطا `public` و`auth`، 17 جدولاً، كلها مُسترجَعة ومطابقة للإنتاج لحظة النسخ:
orders 243 · order_items 1805 · order_status_history 1258 · stock_movements 3100 ·
products 450 · product_images 706 · whatsapp_leads 64 · order_deletions 68 ·
analytics_events 53352 · settings 7 · categories 13 · auth.users 2 · وغيرها.
**لا تحتوي:** ملفات الصور نفسها (في Supabase Storage لمشروع الإنتاج، لا تمسّها migrations).

## الاسترجاع (تقني)
1. نزّل الملف المشفّر: لوحة Supabase ← المشروع أعلاه ← Storage ← prod-backups ← Download.
2. فكّ التشفير:
   `openssl cms -decrypt -binary -inform DER -in tayssir-prod-20261101T171349Z.dump.enc -inkey tayssir-backup-private-key.pem -out prod.dump`
3. تحقّق: `sha256sum prod.dump` = البصمة أعلاه.
4. استرجاع **جداول بعينها** (الحالة المعتادة بعد خطأ migration) إلى قاعدة مؤقتة أولاً،
   ثم نقل الصفوف المطلوبة. استرجاع كامل فوق الإنتاج لا يكون إلا بقرار صريح من صاحب المشروع:
   `pg_restore --no-owner --no-privileges --clean --if-exists -d "<الرابط>" prod.dump`
   (pg_restore ≥ 18، لأن النسخة أُخذت بـpg_dump 18.)

## ما ثبت فعلاً
- داخل آلة Vercel: الاسترجاع الكامل في Postgres نظيف ومقارنة كل جدول ✓ (`RESULT: VERIFIED`).
- بعد التخزين: تنزيل من Supabase ← فكّ بالمفتاح ← البصمة **مطابقة** للنسخة المُتحقَّق منها ✓.
- مفتاح خاطئ ⇒ فشل فكّ التشفير ✓. رابط عام ⇒ 400 ✓.

## ملاحظات
- مشروع Supabase مجاني قد «ينام» بعد أسبوع بلا نشاط: الملف لا يُحذف؛ زرّ Restore project يعيده.
- نسخة غير مشفّرة إضافية في لقطة آلة Vercel `tf-db-backup` تنتهي تلقائياً بعد 7 أيام.
